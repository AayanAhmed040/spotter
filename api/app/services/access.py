"""Authorization rules. Auth0 says *who* you are; these functions decide what you may see or do."""
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, aliased

from ..models import Group, GroupMember, User, Workout

MANAGER_ROLES = {"owner", "admin"}


def membership(db: Session, group_id: int, user: User) -> GroupMember:
    """The caller's membership in a group, or 404 — non-members can't learn the group exists."""
    m = db.scalar(select(GroupMember).where(GroupMember.group_id == group_id, GroupMember.user_id == user.id))
    if m is None or db.get(Group, group_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Group not found")
    return m


def require_manager(m: GroupMember) -> None:
    if m.role not in MANAGER_ROLES:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the group owner or admins can do that")


def connected_user_ids(db: Session, user: User) -> set[int]:
    """Everyone who shares at least one group with `user`, plus `user`."""
    mine = aliased(GroupMember)
    theirs = aliased(GroupMember)
    rows = db.scalars(
        select(theirs.user_id).join(mine, mine.group_id == theirs.group_id).where(mine.user_id == user.id)
    ).all()
    return {user.id, *rows}


def can_view_workout(db: Session, viewer: User, workout: Workout) -> bool:
    if workout.user_id == viewer.id:
        return True
    return workout.visibility == "groups" and workout.user_id in connected_user_ids(db, viewer)


def can_view_user(db: Session, viewer: User, target: User) -> bool:
    return target.id == viewer.id or target.id in connected_user_ids(db, viewer)
