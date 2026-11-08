"""Remove the sample demo accounts created by the old `seed.py`.

Deletes demo users (is_demo = true) — their workouts, reactions and memberships
go with them — plus any group that is left with no real members (e.g. the
"Panorama Push Club" / DEMO42 group). Real users, groups and workouts are not
touched. Shows what it will delete and asks before doing anything.

    cd api
    python scripts/remove_demo_data.py          # dry run + confirmation prompt
    python scripts/remove_demo_data.py --yes    # no prompt
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import func, select  # noqa: E402

from app.db import SessionLocal, init_db  # noqa: E402
from app.models import Group, GroupMember, User, Workout  # noqa: E402


def main(assume_yes: bool) -> None:
    init_db()
    db = SessionLocal()
    demo = db.scalars(select(User).where(User.is_demo.is_(True))).all()
    demo_ids = [u.id for u in demo]
    workouts = db.scalar(select(func.count()).select_from(Workout).where(Workout.user_id.in_(demo_ids))) or 0
    real_members = (
        select(GroupMember.group_id).join(User, User.id == GroupMember.user_id).where(User.is_demo.is_(False))
    )
    empty_groups = db.scalars(select(Group).where(Group.id.not_in(real_members))).all()

    print(f"Demo users: {len(demo)} ({', '.join(u.username for u in demo) or 'none'})")
    print(f"Their workouts: {workouts}")
    print(f"Groups with no real members: {len(empty_groups)} ({', '.join(g.name for g in empty_groups) or 'none'})")
    groups_with_real = db.scalars(
        select(Group).join(GroupMember).where(GroupMember.user_id.in_(demo_ids), Group.id.in_(real_members)).distinct()
    ).all()
    if groups_with_real:
        print("Groups that also have real members (kept, demo members removed):", ", ".join(g.name for g in groups_with_real))
    if not demo and not empty_groups:
        print("Nothing to remove.")
        return
    if not assume_yes and input("Delete these? Type 'yes' to continue: ").strip().lower() != "yes":
        print("Cancelled.")
        return

    for g in empty_groups:
        db.delete(g)
    for u in demo:
        # Groups they created but real people still use: hand creation credit to the oldest real member.
        for g in db.scalars(select(Group).where(Group.created_by_id == u.id)):
            heir = db.scalar(
                select(GroupMember).join(User, User.id == GroupMember.user_id)
                .where(GroupMember.group_id == g.id, User.is_demo.is_(False)).order_by(GroupMember.joined_at)
            )
            if heir:
                g.created_by_id = heir.user_id
                if heir.role == "member":
                    heir.role = "owner"
        for c in u.memberships:
            db.delete(c)
        db.delete(u)
    db.commit()
    print("Done.")


if __name__ == "__main__":
    main("--yes" in sys.argv)
