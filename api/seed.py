"""Seed demo accounts so a fresh deployment has a living group to show.

    python seed.py            # create/refresh demo data
    python seed.py --reset    # wipe demo users first

Creates five demo users (badged "Demo" in the UI; they can't sign in) in a group
with invite code DEMO42 and eight weeks of sample push-up history. Sign in with
your own Auth0 account and join with DEMO42 to see a populated leaderboard and feed.
"""
import argparse
import random
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select

from app.db import SessionLocal, init_db
from app.models import Challenge, Group, GroupMember, Reaction, User, Workout
from app.scoring import SCORING_VERSION, score_session

DEMO_CODE = "DEMO42"
# (username, display name, base depth°, base sag°, reps range, sessions/week, improvement per week)
PEOPLE = [
    ("maya_runs", "Maya Okafor", 84, 5, (14, 24), 4, 0.4),
    ("jules_b", "Jules Bernard", 96, 14, (18, 32), 3, 1.6),
    ("sam_lifts", "Sam Patel", 90, 9, (8, 15), 3, 2.2),
    ("noor_k", "Noor Khan", 88, 7, (5, 11), 2, 1.8),
    ("leo_m", "Leo Martins", 99, 18, (20, 35), 2, 0.5),
]
AVATAR = "https://api.dicebear.com/9.x/notionists/svg?seed={}&backgroundColor=ffc83d,9ad1ff,b8f2d6"


def make_reps(rng: random.Random, n: int, depth: float, sag: float) -> list[dict]:
    reps = []
    for i in range(n):
        fatigue = i / max(1, n)
        d = depth + rng.gauss(0, 4) + fatigue * 6
        dev = max(0.0, sag + rng.gauss(0, 2.5) + fatigue * 5)
        reps.append(
            {
                "index": i + 1,
                "valid": d <= 105,
                "invalidReason": None if d <= 105 else "Not deep enough",
                "startMs": i * 1700,
                "durationMs": int(rng.uniform(900, 1700) - fatigue * 300),
                "minElbowAngle": round(min(d, 130), 1),
                "topElbowAngle": round(rng.uniform(158, 172), 1),
                "meanBodyDeviation": round(dev, 1),
                "maxBodyDeviation": round(dev + rng.uniform(2, 6), 1),
                "hipFault": "sag" if dev > 12 else None,
                "confidence": round(rng.uniform(0.72, 0.96), 2),
                "usedKneesForAlignment": False,
            }
        )
    return reps


def main(reset: bool) -> None:
    init_db()
    rng = random.Random(7)
    db = SessionLocal()
    if reset:
        db.execute(delete(User).where(User.is_demo.is_(True)))
        db.execute(delete(Group).where(Group.invite_code == DEMO_CODE))
        db.commit()

    users = []
    for username, name, *_ in PEOPLE:
        u = db.scalar(select(User).where(User.username == username))
        if u is None:
            u = User(auth0_sub=f"demo|{username}", username=username, display_name=name,
                     avatar_url=AVATAR.format(username), is_demo=True)
            db.add(u)
        users.append(u)
    db.flush()

    g = db.scalar(select(Group).where(Group.invite_code == DEMO_CODE))
    if g is None:
        g = Group(name="Panorama Push Club", description="Lunchtime push-ups, rain or shine.",
                  invite_code=DEMO_CODE, created_by_id=users[0].id)
        db.add(g)
        db.flush()
        for i, u in enumerate(users):
            db.add(GroupMember(group_id=g.id, user_id=u.id, role="owner" if i == 0 else "member"))

    # Fresh sample history.
    db.execute(delete(Workout).where(Workout.user_id.in_([u.id for u in users])))
    now = datetime.now(UTC)
    all_workouts = []
    for u, (_, _, depth, sag, (lo, hi), per_week, gain) in zip(users, PEOPLE):
        for week in range(8, -1, -1):
            days = sorted(rng.sample(range(7), k=min(7, max(1, per_week + rng.choice([-1, 0, 0, 1])))))
            for day in days:
                when = now - timedelta(days=week * 7 + (6 - day), hours=rng.uniform(0, 10))
                if when > now - timedelta(hours=1):
                    continue
                progress = (8 - week) * gain
                n = rng.randint(lo, hi) + (8 - week) // 3
                reps = make_reps(rng, n, depth - progress * 0.8, max(0, sag - progress))
                s = score_session(reps, 20)
                w = Workout(
                    user_id=u.id, exercise="pushup", source="seed", visibility="groups", started_at=when,
                    duration_ms=n * 1700 + rng.randint(5000, 20000), target_reps=20, valid_reps=s.valid_reps,
                    attempted_reps=s.attempted_reps, form_score=s.form_score, rep_score=s.rep_score,
                    final_score=s.final_score, consistency=s.consistency, confidence=s.confidence,
                    scoring_version=SCORING_VERSION, component_averages=s.component_averages, rep_metrics=s.reps,
                    created_at=when,
                )
                db.add(w)
                all_workouts.append(w)
    db.flush()

    db.execute(delete(Reaction).where(Reaction.user_id.in_([u.id for u in users])))
    for w in all_workouts:
        if w.started_at < now - timedelta(days=21):
            continue
        for u in rng.sample(users, k=rng.randint(0, 3)):
            if u.id != w.user_id:
                db.add(Reaction(workout_id=w.id, user_id=u.id, kind=rng.choice(["strong", "fire", "clap", "form"]),
                                created_at=w.started_at + timedelta(minutes=rng.randint(5, 300))))

    db.execute(delete(Challenge).where(Challenge.group_id == g.id))
    start = now - timedelta(days=3)
    db.add(Challenge(
        group_id=g.id, title="1,000 together this week",
        description="Every valid push-up from every member counts. Two sessions each matters more than one huge set.",
        goal_reps=1000, min_sessions_per_member=2, starts_at=start, ends_at=start + timedelta(days=7),
        difficulty="moderate", source="rules", rationale="Sample challenge created by the seed script.",
        created_by_id=users[0].id,
    ))
    db.commit()
    print(f"Seeded {len(users)} demo users, {len(all_workouts)} workouts. Join with invite code {DEMO_CODE}.")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--reset", action="store_true")
    main(p.parse_args().reset)
