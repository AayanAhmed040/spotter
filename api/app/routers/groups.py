import secrets
from datetime import timedelta
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from ..auth import DB, CurrentUser
from ..db import as_utc, utcnow
from ..models import COMPETITIVE_SOURCES, Challenge, Group, GroupMember, Workout
from ..schemas import GroupCreateIn, JoinGroupIn, RoleIn
from ..services import gemini
from ..services.access import membership, require_manager
from ..services.stats import challenge_out, leaderboard, user_public

router = APIRouter(prefix="/api/groups", tags=["groups"])

EXERCISE_NAMES = {"pushup": "push-ups", "squat": "squats"}

# No 0/O/1/I so codes are easy to read aloud.
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def new_invite_code(db: DB) -> str:
    while True:
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(6))
        if not db.scalar(select(Group.id).where(Group.invite_code == code)):
            return code


def group_out(db: DB, g: Group, m: GroupMember) -> dict[str, Any]:
    count = db.scalar(select(func.count()).select_from(GroupMember).where(GroupMember.group_id == g.id))
    active = db.scalar(
        select(Challenge).where(Challenge.group_id == g.id, Challenge.ends_at >= utcnow()).order_by(Challenge.created_at.desc())
    )
    return {
        "id": g.id,
        "name": g.name,
        "description": g.description,
        # Only managers see the code — they decide who gets invited.
        "inviteCode": g.invite_code if m.role in ("owner", "admin") else None,
        "myRole": m.role,
        "memberCount": count,
        "activeChallengeId": active.id if active else None,
        "createdAt": as_utc(g.created_at).isoformat(),
    }


@router.get("")
def my_groups(user: CurrentUser, db: DB) -> list[dict[str, Any]]:
    ms = db.scalars(select(GroupMember).where(GroupMember.user_id == user.id).order_by(GroupMember.joined_at)).all()
    return [group_out(db, m.group, m) for m in ms]


@router.post("", status_code=201)
def create_group(body: GroupCreateIn, user: CurrentUser, db: DB) -> dict[str, Any]:
    owned = db.scalar(select(func.count()).select_from(Group).where(Group.created_by_id == user.id))
    if owned >= 20:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "You can own up to 20 groups")
    g = Group(name=body.name.strip(), description=body.description, invite_code=new_invite_code(db), created_by_id=user.id)
    db.add(g)
    db.flush()
    m = GroupMember(group_id=g.id, user_id=user.id, role="owner")
    db.add(m)
    db.commit()
    return group_out(db, g, m)


@router.post("/join")
def join_group(body: JoinGroupIn, user: CurrentUser, db: DB) -> dict[str, Any]:
    g = db.scalar(select(Group).where(Group.invite_code == body.invite_code))
    if g is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No group has that invite code")
    m = db.scalar(select(GroupMember).where(GroupMember.group_id == g.id, GroupMember.user_id == user.id))
    if m is None:
        m = GroupMember(group_id=g.id, user_id=user.id, role="member")
        db.add(m)
        db.commit()
    return group_out(db, g, m)


@router.get("/{group_id}")
def get_group(group_id: int, user: CurrentUser, db: DB) -> dict[str, Any]:
    m = membership(db, group_id, user)
    g = m.group
    members = db.scalars(select(GroupMember).where(GroupMember.group_id == g.id).order_by(GroupMember.joined_at)).all()
    return {
        **group_out(db, g, m),
        "members": [{"user": user_public(x.user), "role": x.role, "joinedAt": as_utc(x.joined_at).isoformat()} for x in members],
    }


@router.post("/{group_id}/invite-code")
def rotate_invite_code(group_id: int, user: CurrentUser, db: DB) -> dict[str, Any]:
    m = membership(db, group_id, user)
    require_manager(m)
    m.group.invite_code = new_invite_code(db)
    db.commit()
    return group_out(db, m.group, m)


@router.delete("/{group_id}/members/{user_id}", status_code=204)
def remove_member(group_id: int, user_id: int, user: CurrentUser, db: DB) -> None:
    m = membership(db, group_id, user)
    target = db.scalar(select(GroupMember).where(GroupMember.group_id == group_id, GroupMember.user_id == user_id))
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not a member")
    leaving_self = user_id == user.id
    if not leaving_self:
        require_manager(m)
        if target.role == "owner" or (target.role == "admin" and m.role != "owner"):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You can't remove this member")
    elif target.role == "owner":
        raise HTTPException(status.HTTP_409_CONFLICT, "Owners can't leave — delete the group instead")
    db.delete(target)
    db.commit()


@router.put("/{group_id}/members/{user_id}/role")
def set_role(group_id: int, user_id: int, body: RoleIn, user: CurrentUser, db: DB) -> dict[str, str]:
    m = membership(db, group_id, user)
    if m.role != "owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the owner can change roles")
    target = db.scalar(select(GroupMember).where(GroupMember.group_id == group_id, GroupMember.user_id == user_id))
    if target is None or target.role == "owner":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    target.role = body.role
    db.commit()
    return {"role": target.role}


@router.delete("/{group_id}", status_code=204)
def delete_group(group_id: int, user: CurrentUser, db: DB) -> None:
    m = membership(db, group_id, user)
    if m.role != "owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the owner can delete the group")
    db.delete(m.group)
    db.commit()


@router.get("/{group_id}/leaderboard")
def group_leaderboard(
    group_id: int,
    user: CurrentUser,
    db: DB,
    period: Literal["week", "month", "all"] = "week",
    exercise: Literal["pushup", "squat", "plank"] = "pushup",
) -> dict[str, Any]:
    m = membership(db, group_id, user)
    return leaderboard(db, m.group, period, exercise)


# ---------- challenges ----------

class GenerateChallengeIn(BaseModel):
    difficulty: Literal["easy", "moderate", "hard"] = "moderate"
    days: int = Field(7, ge=3, le=14)
    # Shared goals are rep totals, so they're for rep exercises.
    exercise: Literal["pushup", "squat"] = "pushup"


@router.get("/{group_id}/challenges")
def list_challenges(group_id: int, user: CurrentUser, db: DB, limit: int = Query(5, le=20)) -> list[dict[str, Any]]:
    membership(db, group_id, user)
    cs = db.scalars(
        select(Challenge).where(Challenge.group_id == group_id).order_by(Challenge.created_at.desc()).limit(limit)
    ).all()
    return [challenge_out(db, c) for c in cs]


@router.post("/{group_id}/challenges/generate", status_code=201)
async def generate_challenge(group_id: int, body: GenerateChallengeIn, user: CurrentUser, db: DB) -> dict[str, Any]:
    m = membership(db, group_id, user)
    require_manager(m)
    now = utcnow()
    recent = db.scalar(
        select(Challenge).where(Challenge.group_id == group_id, Challenge.created_at >= now - timedelta(minutes=2))
    )
    if recent:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "A challenge was just created — try again in a couple of minutes")

    member_ids = db.scalars(select(GroupMember.user_id).where(GroupMember.group_id == group_id)).all()
    rows = db.execute(
        select(Workout.user_id, Workout.valid_reps).where(
            Workout.user_id.in_(member_ids),
            Workout.exercise == body.exercise,
            Workout.visibility == "groups",
            Workout.source.in_(COMPETITIVE_SOURCES),
            Workout.started_at >= now - timedelta(days=14),
        )
    ).all()
    per_member = {uid: 0 for uid in member_ids}
    for uid, reps in rows:
        per_member[uid] += reps or 0
    active = [v for v in per_member.values() if v > 0]
    # Aggregates only: no names or identities go to Gemini.
    group_stats = {
        "memberCount": len(member_ids),
        "activeMembersLast14Days": len(active),
        "sessionsLast14Days": len(rows),
        "validRepsLast14Days": sum(per_member.values()),
        "medianRepsPerActiveMemberLast14Days": sorted(active)[len(active) // 2] if active else 0,
        "exercise": EXERCISE_NAMES[body.exercise],
        "durationDays": body.days,
        "difficulty": body.difficulty,
    }
    data, source, model = await gemini.group_challenge(group_stats, body.difficulty, body.days, EXERCISE_NAMES[body.exercise])

    # One active challenge at a time: end any current one now.
    for c in db.scalars(select(Challenge).where(Challenge.group_id == group_id, Challenge.ends_at >= now)):
        c.ends_at = now
    c = Challenge(
        group_id=group_id,
        exercise=body.exercise,
        title=data["title"].strip(),
        description=data["description"].strip(),
        goal_reps=int(data["goal_reps"]),
        min_sessions_per_member=int(data["min_sessions_per_member"]),
        starts_at=now,
        ends_at=now + timedelta(days=body.days),
        difficulty=body.difficulty,
        source=source,
        ai_model=model,
        rationale=data.get("rationale"),
        created_by_id=user.id,
    )
    db.add(c)
    db.commit()
    return challenge_out(db, c)


@router.delete("/{group_id}/challenges/{challenge_id}", status_code=204)
def end_challenge(group_id: int, challenge_id: int, user: CurrentUser, db: DB) -> None:
    m = membership(db, group_id, user)
    require_manager(m)
    c = db.get(Challenge, challenge_id)
    if c is None or c.group_id != group_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Challenge not found")
    c.ends_at = min(as_utc(c.ends_at), utcnow())
    db.commit()
