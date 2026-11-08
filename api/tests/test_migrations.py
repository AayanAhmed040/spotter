"""The multi-exercise migration must upgrade an existing (push-ups only) database in
place: same rows, same ids, reactions still attached, new exercises storable."""
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import create_engine, inspect, select
from sqlalchemy.orm import Session

from app.db import init_db
from app.migrations import run_migrations
from app.models import Reaction, Workout

FIXTURE = Path(__file__).parent / "fixtures" / "schema_v0_sqlite.sql"


def old_db(tmp_path) -> str:
    path = tmp_path / "old.db"
    con = sqlite3.connect(path)
    con.executescript(FIXTURE.read_text())
    con.close()
    return f"sqlite:///{path}"


def counts(url: str) -> dict[str, int]:
    con = sqlite3.connect(url.removeprefix("sqlite:///"))
    out = {t: con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in ("users", "groups", "group_members", "workouts", "reactions", "challenges", "insights")}
    con.close()
    return out


def test_upgrades_existing_sqlite_database_without_losing_data(tmp_path):
    url = old_db(tmp_path)
    before = counts(url)
    con = sqlite3.connect(url.removeprefix("sqlite:///"))
    old_rows = con.execute("SELECT id, user_id, valid_reps, final_score, rep_metrics FROM workouts ORDER BY id").fetchall()
    con.close()
    assert before["workouts"] == 12 and before["reactions"] == 6

    from sqlalchemy import event

    engine = create_engine(url)

    @event.listens_for(engine, "connect")
    def _fk(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    init_db(engine)

    assert counts(url) == before
    cols = {c["name"]: c for c in inspect(engine).get_columns("workouts")}
    assert {"metric_kind", "hold_ms", "longest_hold_ms", "target_hold_ms", "hold_score", "hold_windows"} <= set(cols)
    assert all(cols[c]["nullable"] for c in ("valid_reps", "attempted_reps", "rep_score", "target_reps"))
    assert {ix["name"] for ix in inspect(engine).get_indexes("workouts")} >= {"ix_workouts_user_started", "ix_workouts_user_id"}

    with Session(engine) as db:
        rows = db.execute(select(Workout.id, Workout.user_id, Workout.valid_reps, Workout.final_score, Workout.metric_kind).order_by(Workout.id)).all()
        assert [(r[0], r[1], r[2], r[3]) for r in rows] == [(o[0], o[1], o[2], o[3]) for o in old_rows]
        assert {r.metric_kind for r in rows} == {"reps"}
        first = db.get(Workout, rows[0].id)
        assert first.rep_metrics and len(first.rep_metrics) == first.attempted_reps

        # A plank (no reps at all) can now be stored.
        db.add(Workout(user_id=first.user_id, exercise="plank", metric_kind="hold", source="camera", visibility="groups",
                       started_at=datetime.now(UTC), duration_ms=60000, form_score=90, final_score=93, consistency=95,
                       confidence=0.9, scoring_version=1, component_averages={}, rep_metrics=[], hold_ms=55000,
                       longest_hold_ms=55000, target_hold_ms=60000, hold_score=91.7, hold_windows=[]))
        db.commit()

        # Reactions still reference the same workouts, and cascades still work.
        reacted = db.scalar(select(Reaction.workout_id).limit(1))
        db.delete(db.get(Workout, reacted))
        db.commit()
        assert db.scalar(select(Reaction).where(Reaction.workout_id == reacted)) is None


def test_migrations_run_once_and_are_noops_on_fresh_databases(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'fresh.db'}")
    init_db(engine)
    assert run_migrations(engine) == []  # already recorded
    url = old_db(tmp_path)
    engine2 = create_engine(url)
    init_db(engine2)
    assert run_migrations(engine2) == []
