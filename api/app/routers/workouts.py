from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from ..auth import DB, CurrentUser
from ..db import utcnow
from ..models import Reaction, Workout
from ..schemas import ReactionIn, WorkoutCreateIn, WorkoutPatchIn
from ..scoring import SCORING_VERSION, score_session
from ..services.access import can_view_workout, connected_user_ids, membership
from ..services.stats import workout_out

router = APIRouter(prefix="/api", tags=["workouts"])


@router.post("/workouts", status_code=201)
def create_workout(body: WorkoutCreateIn, user: CurrentUser, db: DB) -> dict[str, Any]:
    started = body.started_at if body.started_at.tzinfo else body.started_at.replace(tzinfo=UTC)
    started = started.astimezone(UTC)
    now = utcnow()
    if started > now + timedelta(minutes=5) or started < now - timedelta(days=2):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "startedAt must be within the last 48 hours")
    recent = db.scalar(
        select(func.count()).select_from(Workout).where(Workout.user_id == user.id, Workout.created_at >= now - timedelta(minutes=1))
    )
    if recent >= 5:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Slow down — too many workouts saved in a minute")

    # Scores are recomputed here from raw measurements; client-side scores are previews only.
    s = score_session([r.model_dump() for r in body.reps], body.target_reps)
    w = Workout(
        user_id=user.id,  # always the authenticated user — never from the request body
        exercise=body.exercise,
        source=body.source,
        visibility=body.visibility,
        started_at=started,
        duration_ms=body.duration_ms,
        target_reps=s.target_reps,
        valid_reps=s.valid_reps,
        attempted_reps=s.attempted_reps,
        form_score=s.form_score,
        rep_score=s.rep_score,
        final_score=s.final_score,
        consistency=s.consistency,
        confidence=s.confidence,
        scoring_version=SCORING_VERSION,
        component_averages=s.component_averages,
        rep_metrics=s.reps,
        note=body.note,
    )
    db.add(w)
    db.commit()
    db.refresh(w)
    return workout_out(w, user.id, include_reps=True)


def _load(db: DB, workout_id: int) -> Workout:
    w = db.get(Workout, workout_id)
    if w is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workout not found")
    return w


@router.get("/workouts/{workout_id}")
def get_workout(workout_id: int, user: CurrentUser, db: DB) -> dict[str, Any]:
    w = _load(db, workout_id)
    if not can_view_workout(db, user, w):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workout not found")
    return workout_out(w, user.id, include_reps=True)


@router.patch("/workouts/{workout_id}")
def update_workout(workout_id: int, body: WorkoutPatchIn, user: CurrentUser, db: DB) -> dict[str, Any]:
    w = _load(db, workout_id)
    if w.user_id != user.id:
        # Same response as "doesn't exist" for non-viewers; 403 for groupmates who can see it.
        if not can_view_workout(db, user, w):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Workout not found")
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only edit your own workouts")
    if body.visibility:
        w.visibility = body.visibility
    if body.note is not None:
        w.note = body.note or None
    db.commit()
    return workout_out(w, user.id, include_reps=True)


@router.delete("/workouts/{workout_id}", status_code=204)
def delete_workout(workout_id: int, user: CurrentUser, db: DB) -> None:
    w = _load(db, workout_id)
    if w.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND if not can_view_workout(db, user, w) else status.HTTP_403_FORBIDDEN, "Not allowed")
    db.delete(w)
    db.commit()


@router.post("/workouts/{workout_id}/reactions")
def toggle_reaction(workout_id: int, body: ReactionIn, user: CurrentUser, db: DB) -> dict[str, Any]:
    w = _load(db, workout_id)
    if not can_view_workout(db, user, w):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workout not found")
    existing = db.scalar(
        select(Reaction).where(Reaction.workout_id == w.id, Reaction.user_id == user.id, Reaction.kind == body.kind)
    )
    if existing:
        db.delete(existing)
    else:
        db.add(Reaction(workout_id=w.id, user_id=user.id, kind=body.kind))
    db.commit()
    db.refresh(w)
    return workout_out(w, user.id)


@router.get("/feed")
def feed(
    user: CurrentUser,
    db: DB,
    group_id: int | None = Query(None, alias="groupId"),
    before: datetime | None = None,
    limit: int = Query(20, ge=1, le=50),
) -> dict[str, Any]:
    if group_id is not None:
        from ..models import GroupMember

        membership(db, group_id, user)
        authors = set(db.scalars(select(GroupMember.user_id).where(GroupMember.group_id == group_id)))
    else:
        authors = connected_user_ids(db, user)
    q = (
        select(Workout)
        .options(selectinload(Workout.reactions), selectinload(Workout.user))
        .where(Workout.user_id.in_(authors))
        .where((Workout.visibility == "groups") | (Workout.user_id == user.id))
    )
    if before:
        q = q.where(Workout.started_at < (before if before.tzinfo else before.replace(tzinfo=UTC)).astimezone(UTC))
    rows = db.scalars(q.order_by(Workout.started_at.desc()).limit(limit + 1)).all()
    items = [workout_out(w, user.id) for w in rows[:limit]]
    return {"items": items, "nextBefore": items[-1]["startedAt"] if len(rows) > limit else None}
