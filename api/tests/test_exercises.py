"""Squats and planks end-to-end through the API: storage, scoring, feed, profile, boards."""
from datetime import UTC, datetime, timedelta

import pytest


def squat_rep(i=1, **kw):
    r = {"index": i, "valid": True, "invalidReason": None, "startMs": i * 2500, "durationMs": 2000,
         "minKneeAngle": 62, "topKneeAngle": 174, "maxTorsoLean": 32, "meanTorsoLean": 18,
         "reachedParallel": True, "frontView": False, "confidence": 0.88}
    r.update(kw)
    return r


def window(i=0, **kw):
    w = {"segment": 0, "startMs": i * 5000, "durationMs": 5000, "meanBodyDeviation": 4, "meanStackOffset": 0.12,
         "hipSway": 0.005, "sagShare": 0, "pikeShare": 0, "confidence": 0.9}
    w.update(kw)
    return w


def now_iso(minutes_ago=5):
    return (datetime.now(UTC) - timedelta(minutes=minutes_ago)).isoformat()


def squats(n=12, **kw):
    return {"exercise": "squat", "source": "camera", "visibility": "groups", "startedAt": now_iso(),
            "durationMs": 60_000, "targetReps": 20, "reps": [squat_rep(i + 1, **kw) for i in range(n)]}


def plank(windows, target_ms=60_000, duration_ms=None):
    return {"exercise": "plank", "source": "camera", "visibility": "groups", "startedAt": now_iso(),
            "durationMs": duration_ms or sum(w["durationMs"] for w in windows) + 3000,
            "targetHoldMs": target_ms, "holdWindows": windows}


@pytest.fixture
def pair(actor):
    alice, bob = actor("auth0|alice"), actor("auth0|bob")
    g = alice.post("/api/groups", json={"name": "Crew"}).json()
    bob.post("/api/groups/join", json={"inviteCode": g["inviteCode"]})
    return alice, bob, g


def test_squat_workout_is_scored_and_stored_as_reps(pair):
    alice, *_ = pair
    body = squats(12)
    body["reps"].append(squat_rep(13, minKneeAngle=118))  # client says valid; too shallow
    w = alice.post("/api/workouts", json=body).json()
    assert w["exercise"] == "squat" and w["metricKind"] == "reps"
    assert w["validReps"] == 12 and w["attemptedReps"] == 13
    assert w["reps"][12]["invalidReason"] == "Not deep enough"
    assert w["holdMs"] is None and w["holdScore"] is None
    assert w["volumeScore"] == w["repScore"] == 60.0


def test_plank_workout_is_scored_and_stored_as_hold(pair):
    alice, *_ = pair
    ws = [window(i) for i in range(6)] + [window(6, segment=1, confidence=0.2)] + [window(7 + i, segment=1) for i in range(3)]
    w = alice.post("/api/workouts", json=plank(ws)).json()
    assert w["exercise"] == "plank" and w["metricKind"] == "hold"
    assert w["validReps"] is None and w["attemptedReps"] is None and w["repScore"] is None
    assert w["holdMs"] == 45_000  # the blurry window doesn't count
    assert w["longestHoldMs"] == 30_000
    assert w["volumeScore"] == w["holdScore"] == 75.0
    assert len(w["holdWindows"]) == 10 and w["holdWindows"][6]["counted"] is False


@pytest.mark.parametrize(
    "body",
    [
        {"exercise": "plank", "reps": []},  # plank with reps
        {"exercise": "squat", "holdWindows": []},  # squat without reps
        {"exercise": "squat", "reps": [{"index": 1, "valid": True, "startMs": 0, "durationMs": 900, "minElbowAngle": 80,
                                        "topElbowAngle": 170, "meanBodyDeviation": 3, "maxBodyDeviation": 5, "confidence": 0.9}]},  # push-up fields
        {"exercise": "plank", "holdWindows": [window(0, durationMs=9000)]},  # window too long
        {"exercise": "lunge", "reps": []},  # unknown exercise
    ],
)
def test_rejects_malformed_exercise_payloads(pair, body):
    alice, *_ = pair
    base = {"source": "camera", "startedAt": now_iso(), "durationMs": 60_000}
    assert alice.post("/api/workouts", json=base | body).status_code == 422


def test_hold_cannot_exceed_workout_duration(pair):
    alice, *_ = pair
    assert alice.post("/api/workouts", json=plank([window(i) for i in range(6)], duration_ms=10_000)).status_code == 422


def test_feed_profile_and_calendar_handle_all_exercises(pair):
    alice, bob, _ = pair
    alice.post("/api/workouts", json=squats(10))
    alice.post("/api/workouts", json=plank([window(i) for i in range(4)]))
    feed = bob.get("/api/feed").json()["items"]
    assert {w["exercise"] for w in feed} == {"squat", "plank"}
    assert bob.get("/api/feed?exercise=plank").json()["items"][0]["holdMs"] == 20_000

    me = alice.get("/api/me").json()
    p = alice.get(f"/api/users/{me['username']}?tz=UTC&days=7").json()
    bx = p["stats"]["byExercise"]
    assert bx["squat"]["totalValidReps"] == 10 and bx["squat"]["workouts"] == 1
    assert bx["plank"]["totalHoldMs"] == 20_000 and bx["plank"]["longestHoldMs"] == 20_000
    assert bx["pushup"]["workouts"] == 0 and bx["pushup"]["bestScore"] is None
    today = p["calendar"][-1]
    assert today["workouts"] == 2 and today["reps"] == 10 and today["holdMs"] == 20_000
    assert today["exercises"] == ["plank", "squat"]
    history = alice.get(f"/api/users/{me['username']}/workouts?exercise=plank").json()
    assert [w["exercise"] for w in history] == ["plank"]


def test_leaderboards_are_per_exercise(pair):
    alice, bob, g = pair
    alice.post("/api/workouts", json=squats(15))
    bob.post("/api/workouts", json=plank([window(i) for i in range(8)]))
    sq = alice.get(f"/api/groups/{g['id']}/leaderboard?exercise=squat").json()
    assert sq["metricKind"] == "reps" and "mostReps" in sq["categories"] and "longestHold" not in sq["categories"]
    assert len(sq["categories"]["topScore"]) == 1
    pk = alice.get(f"/api/groups/{g['id']}/leaderboard?exercise=plank").json()
    assert pk["metricKind"] == "hold" and "longestHold" in pk["categories"]
    top = next(r for r in pk["rows"] if r["bestScore"] is not None)
    assert top["longestHoldMs"] == 40_000 and top["totalValidReps"] is None
    pu = alice.get(f"/api/groups/{g['id']}/leaderboard?exercise=pushup").json()
    assert pu["categories"]["topScore"] == []


def test_squat_challenge_counts_only_squats(pair):
    alice, bob, g = pair
    c = alice.post(f"/api/groups/{g['id']}/challenges/generate", json={"exercise": "squat", "days": 7}).json()
    assert c["exercise"] == "squat"
    bob.post("/api/workouts", json=squats(8) | {"startedAt": datetime.now(UTC).isoformat()})
    bob.post("/api/workouts", json=plank([window(0)]) | {"startedAt": datetime.now(UTC).isoformat()})
    progress = alice.get(f"/api/groups/{g['id']}/challenges").json()[0]
    assert progress["progressReps"] == 8
    assert alice.post(f"/api/groups/{g['id']}/challenges/generate", json={"exercise": "plank"}).status_code == 422


def test_insight_summarises_each_exercise(pair):
    alice, *_ = pair
    alice.post("/api/workouts", json=squats(10))
    alice.post("/api/workouts", json=plank([window(i) for i in range(18)]))
    i = alice.get("/api/me/insights?tz=UTC").json()
    assert "10 squats" in i["summary"] and "1:30 of planking" in i["summary"]
    assert i["stats"]["byExercise"]["plank"]["holdSeconds"] == 90


def test_remove_demo_data_script(client, actor, monkeypatch):
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import Group, GroupMember, User, Workout
    from scripts import remove_demo_data

    real = actor("auth0|real")
    real.get("/api/me")
    db = SessionLocal()
    demo = User(auth0_sub="demo|maya", username="maya_demo", display_name="Maya", is_demo=True)
    db.add(demo)
    db.flush()
    demo_only = Group(name="Demo only", invite_code="DEMO42", created_by_id=demo.id)
    mixed = Group(name="Mixed", invite_code="MIXED1", created_by_id=demo.id)
    db.add_all([demo_only, mixed])
    db.flush()
    real_id = db.scalar(select(User.id).where(User.auth0_sub == "auth0|real"))
    db.add_all([GroupMember(group_id=demo_only.id, user_id=demo.id, role="owner"),
                GroupMember(group_id=mixed.id, user_id=demo.id, role="owner"),
                GroupMember(group_id=mixed.id, user_id=real_id, role="member")])
    db.commit()
    real.post("/api/workouts", json=squats(3))
    db.close()

    remove_demo_data.main(assume_yes=True)

    db = SessionLocal()
    assert db.scalar(select(User).where(User.is_demo.is_(True))) is None
    assert {g.name for g in db.scalars(select(Group))} == {"Mixed"}
    assert db.scalar(select(GroupMember.role).where(GroupMember.user_id == real_id)) == "owner"
    assert db.scalar(select(Workout.id).where(Workout.user_id == real_id)) is not None
    db.close()
