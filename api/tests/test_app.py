import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from app.scoring import score_session


def rep(i=1, **kw):
    r = {
        "index": i, "valid": True, "invalidReason": None, "startMs": i * 1500, "durationMs": 1200,
        "minElbowAngle": 86, "topElbowAngle": 168, "meanBodyDeviation": 5, "maxBodyDeviation": 9,
        "hipFault": None, "confidence": 0.9, "usedKneesForAlignment": False,
    }
    r.update(kw)
    return r


def workout(n=10, source="camera", visibility="groups", **repkw):
    return {
        "source": source,
        "visibility": visibility,
        "startedAt": (datetime.now(UTC) - timedelta(minutes=5)).isoformat(),
        "durationMs": 60_000,
        "targetReps": 20,
        "reps": [rep(i + 1, **repkw) for i in range(n)],
    }


@pytest.fixture
def crew(actor):
    """Alice owns a group; Bob joins it; Eve is a stranger."""
    alice, bob, eve = actor("auth0|alice"), actor("auth0|bob"), actor("auth0|eve")
    g = alice.post("/api/groups", json={"name": "Morning crew"}).json()
    assert bob.post("/api/groups/join", json={"inviteCode": g["inviteCode"].lower()}).status_code == 200
    eve.get("/api/me")
    return alice, bob, eve, g


# ---------- scoring parity ----------

def test_python_scorers_match_shared_fixture():
    from app.scoring import score_hold, score_reps

    fixture = json.loads((Path(__file__).parents[2] / "shared" / "scoring-cases.json").read_text())
    assert {c["exercise"] for c in fixture["cases"]} == {"pushup", "squat", "plank"}
    for c in fixture["cases"]:
        if "holdWindows" in c:
            s = score_hold(c["exercise"], c["holdWindows"], c["target"] * 1000)
            got = {"formScore": s.form_score, "volumeScore": s.hold_score, "finalScore": s.final_score,
                   "holdMs": s.hold_ms, "longestHoldMs": s.longest_hold_ms}
        else:
            s = score_reps(c["exercise"], c["reps"], c["target"])
            got = {"formScore": s.form_score, "volumeScore": s.rep_score, "finalScore": s.final_score, "validReps": s.valid_reps}
        for key, expected in c["expected"].items():
            assert got[key] == pytest.approx(expected, abs=0.051), (c["name"], key)


def test_brief_example_users_a_and_b():
    from app.scoring import FINAL_FORM_WEIGHT, FINAL_REP_WEIGHT

    assert FINAL_FORM_WEIGHT * 70 + FINAL_REP_WEIGHT * 100 == pytest.approx(79)
    assert FINAL_FORM_WEIGHT * 95 + FINAL_REP_WEIGHT * 75 == pytest.approx(89)


# ---------- workouts ----------

def test_server_recomputes_scores_and_rejects_upgraded_reps(crew):
    alice, *_ = crew
    body = workout(5)
    body["reps"].append(rep(6, minElbowAngle=125))  # client claims valid; it's a half rep
    r = alice.post("/api/workouts", json=body)
    assert r.status_code == 201
    w = r.json()
    assert w["validReps"] == 5
    assert w["attemptedReps"] == 6
    assert w["reps"][5]["valid"] is False
    assert w["reps"][5]["invalidReason"] == "Not deep enough"
    assert w["repScore"] == 25.0


def test_user_id_in_body_is_ignored(crew):
    alice, bob, *_ = crew
    bob_id = bob.get("/api/me").json()["id"]
    body = workout(3) | {"userId": bob_id, "user_id": bob_id}
    w = alice.post("/api/workouts", json=body).json()
    assert w["user"]["username"] == alice.get("/api/me").json()["username"]


def test_rejects_out_of_range_measurements(crew):
    alice, *_ = crew
    assert alice.post("/api/workouts", json=workout(1, minElbowAngle=400)).status_code == 422


# ---------- authorization ----------

def test_feed_visibility(crew):
    alice, bob, eve, _ = crew
    shared = alice.post("/api/workouts", json=workout(8)).json()
    private = alice.post("/api/workouts", json=workout(4, visibility="private")).json()
    eve.post("/api/workouts", json=workout(2))

    bob_feed = {w["id"] for w in bob.get("/api/feed").json()["items"]}
    assert shared["id"] in bob_feed and private["id"] not in bob_feed
    alice_feed = {w["id"] for w in alice.get("/api/feed").json()["items"]}
    assert private["id"] in alice_feed  # own private workouts are visible to yourself
    eve_feed = {w["id"] for w in eve.get("/api/feed").json()["items"]}
    assert shared["id"] not in eve_feed

    assert eve.get(f"/api/workouts/{shared['id']}").status_code == 404
    assert bob.get(f"/api/workouts/{private['id']}").status_code == 404


def test_cannot_edit_or_delete_others_workouts(crew):
    alice, bob, eve, _ = crew
    w = alice.post("/api/workouts", json=workout(5)).json()
    assert bob.patch(f"/api/workouts/{w['id']}", json={"visibility": "private"}).status_code == 403
    assert bob.delete(f"/api/workouts/{w['id']}").status_code == 403
    assert eve.delete(f"/api/workouts/{w['id']}").status_code == 404
    assert alice.patch(f"/api/workouts/{w['id']}", json={"visibility": "private"}).json()["visibility"] == "private"


def test_group_access_and_roles(crew):
    alice, bob, eve, g = crew
    gid = g["id"]
    assert eve.get(f"/api/groups/{gid}").status_code == 404
    assert eve.get(f"/api/groups/{gid}/leaderboard").status_code == 404
    assert eve.get(f"/api/feed?groupId={gid}").status_code == 404
    # Members can't see or rotate the invite code.
    assert bob.get(f"/api/groups/{gid}").json()["inviteCode"] is None
    assert bob.post(f"/api/groups/{gid}/invite-code").status_code == 403
    assert bob.post(f"/api/groups/{gid}/challenges/generate", json={}).status_code == 403
    alice_id = alice.get("/api/me").json()["id"]
    assert bob.delete(f"/api/groups/{gid}/members/{alice_id}").status_code == 403
    # Promote Bob; now he can manage.
    bob_id = bob.get("/api/me").json()["id"]
    assert alice.put(f"/api/groups/{gid}/members/{bob_id}/role", json={"role": "admin"}).status_code == 200
    assert bob.post(f"/api/groups/{gid}/invite-code").status_code == 200
    # Owner can't leave; member can.
    assert alice.delete(f"/api/groups/{gid}/members/{alice_id}").status_code == 409
    assert bob.delete(f"/api/groups/{gid}/members/{bob_id}").status_code == 204


def test_reactions_toggle_and_require_visibility(crew):
    alice, bob, eve, _ = crew
    w = alice.post("/api/workouts", json=workout(5)).json()
    r = bob.post(f"/api/workouts/{w['id']}/reactions", json={"kind": "fire"}).json()
    assert r["reactions"]["fire"] == 1 and r["myReactions"] == ["fire"]
    r = bob.post(f"/api/workouts/{w['id']}/reactions", json={"kind": "fire"}).json()
    assert r["reactions"]["fire"] == 0
    assert eve.post(f"/api/workouts/{w['id']}/reactions", json={"kind": "fire"}).status_code == 404


def test_profile_privacy(crew):
    alice, bob, eve, _ = crew
    username = alice.get("/api/me").json()["username"]
    assert bob.get(f"/api/users/{username}").status_code == 200
    assert eve.get(f"/api/users/{username}").status_code == 404


# ---------- leaderboard, calendar, challenges ----------

def test_leaderboard_ranks_quality_and_excludes_simulations(crew):
    alice, bob, _, g = crew
    alice.post("/api/workouts", json=workout(20, meanBodyDeviation=25, minElbowAngle=100))  # many, sloppy
    bob.post("/api/workouts", json=workout(15))  # fewer, clean
    bob.post("/api/workouts", json=workout(40, source="demo"))  # simulated: must not count
    lb = alice.get(f"/api/groups/{g['id']}/leaderboard?period=week").json()
    top = lb["rows"][0]
    assert top["user"]["username"] == bob.get("/api/me").json()["username"]
    assert top["totalValidReps"] == 15
    assert set(lb["categories"]) == {"topScore", "mostReps", "mostConsistent", "mostImproved", "mostEncouraging"}


def test_calendar_and_stats(crew):
    alice, *_ = crew
    alice.post("/api/workouts", json=workout(12))
    me = alice.get("/api/me").json()
    p = alice.get(f"/api/users/{me['username']}?tz=America/Edmonton&days=14").json()
    assert len(p["calendar"]) == 14
    assert sum(d["reps"] for d in p["calendar"]) == 12
    assert p["stats"]["totalValidReps"] == 12
    assert any(a["id"] == "first-set" and a["earned"] for a in p["stats"]["achievements"])


def test_challenge_generation_falls_back_without_gemini(crew):
    alice, bob, _, g = crew
    c = alice.post(f"/api/groups/{g['id']}/challenges/generate", json={"difficulty": "easy", "days": 7})
    assert c.status_code == 201
    c = c.json()
    assert c["source"] == "rules" and c["goalReps"] > 0 and c["active"]
    # Only reps logged after the challenge starts count.
    bob.post("/api/workouts", json=workout(4))  # started 5 min ago → before the challenge
    bob.post("/api/workouts", json=workout(10) | {"startedAt": datetime.now(UTC).isoformat()})
    progress = alice.get(f"/api/groups/{g['id']}/challenges").json()[0]
    assert progress["progressReps"] == 10
    assert progress["membersParticipating"] == 1
    # Rate limited: no second generation within 2 minutes.
    assert alice.post(f"/api/groups/{g['id']}/challenges/generate", json={}).status_code == 429


def test_weekly_insight_fallback_and_cache(crew):
    alice, *_ = crew
    alice.post("/api/workouts", json=workout(10))
    a = alice.get("/api/me/insights?tz=UTC").json()
    assert a["source"] == "rules"
    assert "10 push-ups" in a["summary"]
    b = alice.get("/api/me/insights?tz=UTC&refresh=true").json()
    assert b["generatedAt"] == a["generatedAt"]  # refresh throttled


def test_weekly_insight_regenerates_when_stats_change(crew, monkeypatch):
    from app.routers import me as me_router

    alice, *_ = crew
    first = alice.get("/api/me/insights?tz=UTC").json()
    assert first["stats"]["sessionsThisWeek"] == 0
    alice.post("/api/workouts", json=workout(10))
    real_now = me_router.utcnow
    monkeypatch.setattr(me_router, "utcnow", lambda: real_now() + timedelta(minutes=3))
    second = alice.get("/api/me/insights?tz=UTC").json()
    assert second["stats"]["sessionsThisWeek"] == 1


def test_gemini_output_is_validated_and_clamped(monkeypatch):
    import asyncio

    from app.services import gemini

    async def fake_generate(prompt, schema):
        return schema(title="Mega week", description="Do a huge number of push-ups together.",
                      goal_reps=20000, min_sessions_per_member=9 if False else 7, rationale="Because.")

    monkeypatch.setattr(gemini, "_generate", fake_generate)
    stats = {"memberCount": 4, "validRepsLast14Days": 280}
    data, source, _ = asyncio.run(gemini.group_challenge(stats, "moderate", 7))
    lo, _, hi = gemini.challenge_bounds(stats, "moderate", 7)
    assert source == "gemini"
    assert lo <= data["goal_reps"] <= hi


def test_banned_content_triggers_fallback():
    from app.services.gemini import BANNED

    assert BANNED.search("This will cure your back injury")
    assert not BANNED.search("Great consistency this week")
