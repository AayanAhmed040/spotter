import logging
from datetime import UTC, date, datetime, timedelta
from statistics import fmean
from typing import Annotated, Any, Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select

from ..auth import DB, PLACEHOLDER_NAMES, CurrentUser, VerifiedToken, current_user, provision_user, verified_token
from ..config import get_settings
from ..db import as_utc, utcnow
from ..models import Insight, User, Workout
from ..schemas import SyncProfileIn, UpdateMeIn
from ..services import gemini
from ..services.access import can_view_user
from ..services.stats import calendar, local_day, tz_or_utc, user_public, user_stats, week_start, workout_out

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["me"])


def me_out(u: User) -> dict[str, Any]:
    return {**user_public(u), "email": u.email, "createdAt": as_utc(u.created_at).isoformat()}


@router.get("/auth/session")
def auth_session(token: Annotated[VerifiedToken, Depends(verified_token)], user: CurrentUser) -> dict[str, Any]:
    """What the backend verified about this request. Shown on the 'Security' screen for demos."""
    c = token.claims
    return {
        "verified": True,
        "algorithm": "RS256",
        "issuer": c["iss"],
        "audience": c["aud"],
        "subject": c["sub"],
        "authorizedParty": c.get("azp"),
        "scopes": sorted(token.scopes),
        "issuedAt": c["iat"],
        "expiresAt": c["exp"],
        "appUserId": user.id,
        # Not shown in the app any more; kept as a diagnostic for verifying Auth0 tokens.
        "checks": [
            "Signature verified with the tenant's published JWKS key",
            "Issuer matches the configured Auth0 tenant",
            "Audience matches this API's identifier",
            "Token is not expired (30s clock-skew leeway)",
            "User resolved from the token's sub — never from request data",
        ],
    }


@router.post("/me/sync")
async def sync_profile(
    body: SyncProfileIn,
    token: Annotated[VerifiedToken, Depends(verified_token)],
    db: DB,
) -> dict[str, Any]:
    """Called once per login. Pulls name/picture/email from Auth0's /userinfo using the
    caller's own access token, and creates the app profile the first time we see this `sub`."""
    profile: dict[str, Any] = {}
    settings = get_settings()
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{settings.auth0_issuer}userinfo", headers={"Authorization": f"Bearer {token.raw}"})
        if r.status_code == 200 and r.json().get("sub") == token.sub:
            profile = r.json()
    except httpx.HTTPError as e:
        log.info("userinfo unavailable: %s", e)
    if not profile:
        profile = body.model_dump(exclude_none=True)  # display hints only — identity is still token.sub

    user = db.scalar(select(User).where(User.auth0_sub == token.sub))
    created = user is None
    if user is None:
        user = provision_user(db, token.sub, profile)
    else:
        if profile.get("picture"):
            user.avatar_url = profile["picture"]
        if profile.get("email") and profile.get("email_verified", True):
            user.email = profile["email"]
        if user.display_name in PLACEHOLDER_NAMES and profile.get("name") and "@" not in profile["name"]:
            user.display_name = profile["name"][:80]
        user.last_seen_at = utcnow()
        db.commit()
    return {"user": me_out(user), "created": created}


@router.get("/me")
def get_me(user: CurrentUser) -> dict[str, Any]:
    return me_out(user)


@router.patch("/me")
def update_me(body: UpdateMeIn, user: CurrentUser, db: DB) -> dict[str, Any]:
    if body.username and body.username != user.username:
        taken = db.scalar(select(User.id).where(User.username == body.username))
        if taken:
            raise HTTPException(status.HTTP_409_CONFLICT, "That username is taken")
        user.username = body.username
    if body.display_name:
        user.display_name = body.display_name.strip()
    db.commit()
    return me_out(user)


@router.get("/users/{username}")
def get_profile(username: str, user: CurrentUser, db: DB, tz: str = "UTC", days: int = Query(140, ge=7, le=371)) -> dict[str, Any]:
    target = db.scalar(select(User).where(User.username == username))
    if target is None or not can_view_user(db, user, target):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    zone = tz_or_utc(tz)
    return {
        "user": user_public(target),
        "isMe": target.id == user.id,
        "stats": user_stats(db, target, zone),
        "calendar": calendar(db, target.id, zone, days),
    }


@router.get("/users/{username}/workouts")
def user_workouts(
    username: str,
    user: CurrentUser,
    db: DB,
    tz: str = "UTC",
    on: date | None = Query(None, alias="date"),
    exercise: Literal["pushup", "squat", "plank"] | None = None,
    limit: int = Query(20, ge=1, le=100),
) -> list[dict[str, Any]]:
    target = db.scalar(select(User).where(User.username == username))
    if target is None or not can_view_user(db, user, target):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    q = select(Workout).where(Workout.user_id == target.id)
    if exercise:
        q = q.where(Workout.exercise == exercise)
    if target.id != user.id:
        q = q.where(Workout.visibility == "groups")
    zone = tz_or_utc(tz)
    if on:
        start = datetime.combine(on, datetime.min.time(), zone).astimezone(UTC)
        q = q.where(Workout.started_at >= start, Workout.started_at < start + timedelta(days=1))
    rows = db.scalars(q.order_by(Workout.started_at.desc()).limit(limit)).all()
    return [workout_out(w, user.id) for w in rows]


# ---------- Gemini weekly insight ----------

def insight_stats(db: DB, user: User, tz: str) -> dict[str, Any]:
    """Aggregate numbers only — this is everything Gemini sees."""
    zone = tz_or_utc(tz)
    today = datetime.now(zone).date()
    this_week = week_start(today)
    last_week = this_week - timedelta(days=7)
    ws = list(db.scalars(select(Workout).where(Workout.user_id == user.id, Workout.source != "demo")).all())
    cur = [w for w in ws if local_day(w.started_at, zone) >= this_week]
    prev = [w for w in ws if last_week <= local_day(w.started_at, zone) < this_week]
    avg = lambda xs: round(fmean(xs), 1) if xs else None  # noqa: E731
    cur_form, prev_form = avg([w.form_score for w in cur]), avg([w.form_score for w in prev])

    by_exercise: dict[str, dict[str, Any]] = {}
    for ex in ("pushup", "squat", "plank"):
        xs = [w for w in cur if w.exercise == ex]
        entry: dict[str, Any] = {"sessions": len(xs), "avgForm": avg([w.form_score for w in xs])}
        if ex == "plank":
            entry["holdSeconds"] = sum(w.hold_ms or 0 for w in xs) // 1000
            entry["longestHoldSeconds"] = max((w.longest_hold_ms or 0 for w in xs), default=0) // 1000
        else:
            entry["validReps"] = sum(w.valid_reps or 0 for w in xs)
        if xs:
            keys = set().union(*(w.component_averages.keys() for w in xs))
            comps = {k: fmean(w.component_averages.get(k, 0) for w in xs) for k in keys}
            entry["weakestFormArea"] = min(comps, key=comps.get) if comps else None
        by_exercise[ex] = entry

    return {
        "daysIntoWeek": (today - this_week).days + 1,
        "sessionsThisWeek": len(cur),
        "activeDaysThisWeek": len({local_day(w.started_at, zone) for w in cur}),
        "avgFormThisWeek": cur_form,
        "byExercise": by_exercise,
        "sessionsLastWeek": len(prev),
        "avgFormLastWeek": prev_form,
        "formChangeVsLastWeek": round(cur_form - prev_form, 1) if cur_form is not None and prev_form is not None else None,
        "lifetimeSessions": len(ws),
        "groupsJoined": len(user.memberships),
    }


@router.get("/me/insights")
async def weekly_insight(user: CurrentUser, db: DB, tz: str = "UTC", refresh: bool = False) -> dict[str, Any]:
    zone = tz_or_utc(tz)
    wk = week_start(datetime.now(zone).date())
    cached = db.scalar(select(Insight).where(Insight.user_id == user.id, Insight.week_start == wk))
    stats = insight_stats(db, user, tz)
    if cached:
        age = utcnow() - as_utc(cached.created_at)
        unchanged = cached.payload.get("stats") == stats
        # Regenerate only when the numbers changed (new workout) or on an explicit refresh,
        # and never more than once every 2 minutes — keeps us well inside Gemini rate limits.
        if age < timedelta(minutes=2) or (unchanged and not (refresh and age >= timedelta(minutes=10))):
            return insight_out(cached)
    payload, source, model = await gemini.weekly_insight(stats)
    payload["stats"] = stats
    if cached:
        cached.payload, cached.source, cached.ai_model, cached.created_at = payload, source, model, utcnow()
    else:
        cached = Insight(user_id=user.id, week_start=wk, payload=payload, source=source, ai_model=model)
        db.add(cached)
    db.commit()
    return insight_out(cached)


def insight_out(i: Insight) -> dict[str, Any]:
    p = i.payload
    return {
        "weekStart": i.week_start.isoformat(),
        "headline": p["headline"],
        "summary": p["summary"],
        "highlights": p["highlights"],
        "nextSteps": p["next_steps"],
        "stats": p.get("stats", {}),
        "source": i.source,
        "aiModel": i.ai_model,
        "generatedAt": as_utc(i.created_at).isoformat(),
    }


# Re-exported so tests can depend on the same user resolution.
__all__ = ["router", "current_user"]
