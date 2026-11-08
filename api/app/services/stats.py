"""Aggregations for profiles, calendars, leaderboards and challenges.

Computed in Python over indexed per-user/per-period queries — fine for groups of
tens to hundreds. The scale-up path is a daily rollup table (or a Timescale
continuous aggregate) keyed by (user_id, day).
"""
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from statistics import fmean
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import as_utc, utcnow
from ..models import COMPETITIVE_SOURCES, HOLD_EXERCISES, REP_EXERCISES, Challenge, Group, GroupMember, Reaction, User, Workout

REACTION_KINDS = ("strong", "fire", "clap", "form")
EXERCISES = (*REP_EXERCISES, *HOLD_EXERCISES)


def tz_or_utc(name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def local_day(dt: datetime, tz: ZoneInfo) -> date:
    return as_utc(dt).astimezone(tz).date()


def week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


# ---------- serialization ----------

def user_public(u: User) -> dict[str, Any]:
    return {
        "id": u.id,
        "username": u.username,
        "displayName": u.display_name,
        "avatarUrl": u.avatar_url,
        "isDemo": u.is_demo,
    }


def workout_out(w: Workout, viewer_id: int, include_reps: bool = False) -> dict[str, Any]:
    counts = {k: 0 for k in REACTION_KINDS}
    mine: list[str] = []
    for r in w.reactions:
        counts[r.kind] = counts.get(r.kind, 0) + 1
        if r.user_id == viewer_id:
            mine.append(r.kind)
    out = {
        "id": w.id,
        "user": user_public(w.user),
        "exercise": w.exercise,
        "metricKind": w.metric_kind,
        "source": w.source,
        "visibility": w.visibility,
        "startedAt": as_utc(w.started_at).isoformat(),
        "durationMs": w.duration_ms,
        # Rep exercises (null for holds)
        "targetReps": w.target_reps,
        "validReps": w.valid_reps,
        "attemptedReps": w.attempted_reps,
        "repScore": w.rep_score,
        # Hold exercises (null for reps)
        "targetHoldMs": w.target_hold_ms,
        "holdMs": w.hold_ms,
        "longestHoldMs": w.longest_hold_ms,
        "holdScore": w.hold_score,
        # Shared
        "formScore": w.form_score,
        "volumeScore": w.volume_score,
        "finalScore": w.final_score,
        "consistency": w.consistency,
        "confidence": w.confidence,
        "componentAverages": w.component_averages,
        "scoringVersion": w.scoring_version,
        "note": w.note,
        "reactions": counts,
        "myReactions": mine,
        "isMine": w.user_id == viewer_id,
    }
    if include_reps:
        out["reps"] = w.rep_metrics or []
        out["holdWindows"] = w.hold_windows or []
    return out


def effort(valid_reps: int | None, hold_ms: int | None) -> float:
    """A rough common unit for the activity calendar only: 1 rep ≈ 2 s of plank."""
    return (valid_reps or 0) + (hold_ms or 0) / 2000


# ---------- personal stats ----------

def calendar(db: Session, user_id: int, tz: ZoneInfo, days: int = 140) -> list[dict[str, Any]]:
    today = datetime.now(tz).date()
    start_day = today - timedelta(days=days - 1)
    # Always compare in UTC (SQLite stores datetimes without an offset).
    since = datetime.combine(start_day, datetime.min.time(), tz).astimezone(UTC)
    rows = db.execute(
        select(Workout.started_at, Workout.exercise, Workout.valid_reps, Workout.hold_ms).where(
            Workout.user_id == user_id, Workout.started_at >= since, Workout.source != "demo"
        )
    ).all()
    by_day: dict[date, list[tuple[str, int | None, int | None]]] = defaultdict(list)
    for started, exercise, reps, hold in rows:
        by_day[local_day(started, tz)].append((exercise, reps, hold))
    out = []
    for i in range(days):
        d = start_day + timedelta(days=i)
        sessions = by_day.get(d, [])
        e = sum(effort(r, h) for _, r, h in sessions)
        # Intensity is about showing up, not volume: any session is green; more effort is brighter.
        level = 0 if not sessions else 1 if len(sessions) == 1 and e < 30 else 2 if e < 50 else 3 if e < 80 else 4
        out.append(
            {
                "date": d.isoformat(),
                "workouts": len(sessions),
                "reps": sum(r or 0 for _, r, _ in sessions),
                "holdMs": sum(h or 0 for _, _, h in sessions),
                "exercises": sorted({x for x, _, _ in sessions}),
                "level": level,
            }
        )
    return out


def _improvement(ws: list[Workout]) -> float | None:
    """Average form of the latest five sessions vs the first five (needs six or more)."""
    if len(ws) < 6:
        return None
    return round(fmean(w.form_score for w in ws[-5:]) - fmean(w.form_score for w in ws[:5]), 1)


def user_stats(db: Session, user: User, tz: ZoneInfo) -> dict[str, Any]:
    workouts = db.scalars(select(Workout).where(Workout.user_id == user.id).order_by(Workout.started_at)).all()
    real = [w for w in workouts if w.source != "demo"]
    today = datetime.now(tz).date()
    this_week = week_start(today)
    days = {local_day(w.started_at, tz) for w in real}
    weeks: dict[date, set[date]] = defaultdict(set)
    for d in days:
        weeks[week_start(d)].add(d)

    # Weeks in a row with at least one active day — rewards a sustainable habit, not daily streaks.
    streak_weeks = 0
    wk = this_week if weeks.get(this_week) else this_week - timedelta(days=7)
    while weeks.get(wk):
        streak_weeks += 1
        wk -= timedelta(days=7)

    # Each exercise is summarised on its own terms — no cross-exercise comparisons.
    by_exercise: dict[str, dict[str, Any]] = {}
    for ex in EXERCISES:
        ws = [w for w in real if w.exercise == ex]
        entry: dict[str, Any] = {
            "workouts": len(ws),
            "bestScore": max((w.final_score for w in ws), default=None),
            "bestFormScore": max((w.form_score for w in ws), default=None),
            "averageFormScore": round(fmean(w.form_score for w in ws), 1) if ws else None,
            "formImprovement": _improvement(ws),
            "lastAt": as_utc(ws[-1].started_at).isoformat() if ws else None,
        }
        if ex in REP_EXERCISES:
            entry["totalValidReps"] = sum(w.valid_reps or 0 for w in ws)
            entry["bestReps"] = max((w.valid_reps or 0 for w in ws), default=0)
        else:
            entry["totalHoldMs"] = sum(w.hold_ms or 0 for w in ws)
            entry["longestHoldMs"] = max((w.longest_hold_ms or 0 for w in ws), default=0)
        by_exercise[ex] = entry

    reactions_given = db.scalar(select(func.count()).select_from(Reaction).where(Reaction.user_id == user.id)) or 0
    groups = db.scalar(select(func.count()).select_from(GroupMember).where(GroupMember.user_id == user.id)) or 0

    stats = {
        "totalWorkouts": len(real),
        "totalValidReps": sum(by_exercise[e]["totalValidReps"] for e in REP_EXERCISES),
        "totalHoldMs": sum(by_exercise[e]["totalHoldMs"] for e in HOLD_EXERCISES),
        "activeDaysThisWeek": len(weeks.get(this_week, set())),
        "activeWeeksStreak": streak_weeks,
        "reactionsGiven": reactions_given,
        "groups": groups,
        "simulatedWorkouts": len(workouts) - len(real),
        "byExercise": by_exercise,
    }
    stats["achievements"] = achievements(stats, weeks)
    return stats


def achievements(s: dict[str, Any], weeks: dict[date, set[date]]) -> list[dict[str, Any]]:
    best_week = max((len(v) for v in weeks.values()), default=0)
    bx = s["byExercise"]
    best_form = max((e["bestFormScore"] or 0 for e in bx.values()), default=0)
    improving = any((e["formImprovement"] or 0) >= 5 for e in bx.values())
    tried = sum(1 for e in bx.values() if e["workouts"] > 0)
    items = [
        ("first-set", "First set", "Logged your first tracked workout", s["totalWorkouts"] >= 1),
        ("crew", "Joined a crew", "Became part of a group", s["groups"] >= 1),
        ("century", "Century", "100 valid reps of push-ups and squats", s["totalValidReps"] >= 100),
        ("steady-week", "Steady week", "Active on 3 different days in one week", best_week >= 3),
        ("clean-form", "Clean form", "Scored 90+ form in a session", best_form >= 90),
        ("all-rounder", "All-rounder", "Tracked push-ups, squats and a plank", tried == len(EXERCISES)),
        ("plank-minute", "Plank minute", "Held a plank for 60 seconds without breaking", bx["plank"]["longestHoldMs"] >= 60_000),
        ("on-the-rise", "On the rise", "Recent form 5+ points above your first sessions", improving),
        ("hype-squad", "Hype squad", "Cheered on teammates 10 times", s["reactionsGiven"] >= 10),
        ("five-hundred", "Five hundred", "500 valid reps in total", s["totalValidReps"] >= 500),
    ]
    return [{"id": i, "title": t, "description": d, "earned": e} for i, t, d, e in items]


# ---------- leaderboard ----------

PERIODS = {"week": 7, "month": 30, "all": None}


def leaderboard(db: Session, group: Group, period: str, exercise: str = "pushup") -> dict[str, Any]:
    """One board per exercise: scores aren't comparable across exercises."""
    now = utcnow()
    span = PERIODS.get(period, 7)
    since = now - timedelta(days=span) if span else datetime(2000, 1, 1, tzinfo=UTC)
    prev_since = since - timedelta(days=span) if span else None
    is_hold = exercise in HOLD_EXERCISES

    members = db.scalars(select(GroupMember).where(GroupMember.group_id == group.id)).all()
    member_ids = [m.user_id for m in members]
    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_(member_ids)))}

    # Only shared, non-simulated workouts of this exercise count toward a group board.
    q = select(Workout).where(
        Workout.user_id.in_(member_ids),
        Workout.exercise == exercise,
        Workout.visibility == "groups",
        Workout.source.in_(COMPETITIVE_SOURCES),
        Workout.started_at >= (prev_since or since),
    )
    current: dict[int, list[Workout]] = defaultdict(list)
    previous: dict[int, list[Workout]] = defaultdict(list)
    for w in db.scalars(q):
        (current if as_utc(w.started_at) >= since else previous)[w.user_id].append(w)

    # Encouragement: reactions given to groupmates' workouts in the period (any exercise).
    cheers: dict[int, int] = defaultdict(int)
    for uid, owner in db.execute(
        select(Reaction.user_id, Workout.user_id)
        .join(Workout, Workout.id == Reaction.workout_id)
        .where(Reaction.user_id.in_(member_ids), Workout.user_id.in_(member_ids), Reaction.created_at >= since)
    ):
        if uid != owner:
            cheers[uid] += 1

    rows = []
    for m in members:
        ws = current.get(m.user_id, [])
        prev = previous.get(m.user_id, [])
        avg = round(fmean(w.final_score for w in ws), 1) if ws else None
        prev_avg = fmean(w.final_score for w in prev) if prev else None
        row: dict[str, Any] = {
            "user": user_public(users[m.user_id]),
            "role": m.role,
            "bestScore": max((w.final_score for w in ws), default=None),
            "averageScore": avg,
            "workouts": len(ws),
            "activeDays": len({as_utc(w.started_at).date() for w in ws}),
            "improvement": round(avg - prev_avg, 1) if avg is not None and prev_avg is not None else None,
            "cheersGiven": cheers.get(m.user_id, 0),
            "totalValidReps": None if is_hold else sum(w.valid_reps or 0 for w in ws),
            "totalHoldMs": sum(w.hold_ms or 0 for w in ws) if is_hold else None,
            "longestHoldMs": max((w.longest_hold_ms or 0 for w in ws), default=0) if is_hold else None,
        }
        rows.append(row)

    def rank(key: str) -> list[int]:
        ordered = sorted(rows, key=lambda r: (r[key] is None, -(r[key] or 0)))
        return [r["user"]["id"] for r in ordered if r[key] is not None and r[key] > 0]

    categories = {
        "topScore": rank("bestScore"),
        "mostConsistent": rank("activeDays"),
        "mostImproved": rank("improvement"),
        "mostEncouraging": rank("cheersGiven"),
    }
    if is_hold:
        categories["longestHold"] = rank("longestHoldMs")
    else:
        categories["mostReps"] = rank("totalValidReps")

    return {
        "period": period,
        "exercise": exercise,
        "metricKind": "hold" if is_hold else "reps",
        "rows": sorted(rows, key=lambda r: (r["bestScore"] is None, -(r["bestScore"] or 0))),
        # Separate recognitions so the board isn't only about the fittest person.
        "categories": categories,
    }


# ---------- challenges ----------

def challenge_out(db: Session, c: Challenge) -> dict[str, Any]:
    member_ids = db.scalars(select(GroupMember.user_id).where(GroupMember.group_id == c.group_id)).all()
    rows = db.execute(
        select(Workout.user_id, Workout.valid_reps).where(
            Workout.user_id.in_(member_ids),
            Workout.visibility == "groups",
            Workout.source.in_(COMPETITIVE_SOURCES),
            Workout.exercise == c.exercise,
            Workout.started_at >= c.starts_at,
            Workout.started_at <= c.ends_at,
        )
    ).all()
    reps_by_user: dict[int, int] = defaultdict(int)
    sessions_by_user: dict[int, int] = defaultdict(int)
    for uid, reps in rows:
        reps_by_user[uid] += reps or 0
        sessions_by_user[uid] += 1
    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_(member_ids)))}
    total = sum(reps_by_user.values())
    contributors = [
        {
            "user": user_public(users[uid]),
            "reps": reps_by_user.get(uid, 0),
            "sessions": sessions_by_user.get(uid, 0),
            "metMinimum": sessions_by_user.get(uid, 0) >= c.min_sessions_per_member,
        }
        for uid in member_ids
    ]
    contributors.sort(key=lambda r: -r["reps"])
    now = utcnow()
    return {
        "id": c.id,
        "groupId": c.group_id,
        "title": c.title,
        "description": c.description,
        "exercise": c.exercise,
        "goalReps": c.goal_reps,
        "minSessionsPerMember": c.min_sessions_per_member,
        "difficulty": c.difficulty,
        "startsAt": as_utc(c.starts_at).isoformat(),
        "endsAt": as_utc(c.ends_at).isoformat(),
        "active": as_utc(c.starts_at) <= now <= as_utc(c.ends_at),
        "source": c.source,
        "aiModel": c.ai_model,
        "rationale": c.rationale,
        "progressReps": total,
        "progress": round(min(1.0, total / c.goal_reps), 3) if c.goal_reps else 0,
        "membersParticipating": sum(1 for r in contributors if r["sessions"] > 0),
        "membersMetMinimum": sum(1 for r in contributors if r["metMinimum"]),
        "memberCount": len(member_ids),
        "contributors": contributors,
    }
