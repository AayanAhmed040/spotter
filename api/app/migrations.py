"""Versioned, in-place schema migrations.

Runs on every startup after `create_all`. Each migration runs once (tracked in
`schema_migrations`), is idempotent, and preserves all existing rows. Fresh
databases already have the latest schema from the models, so migrations there
are no-ops that just get recorded.

To add one: write `def mNNN_name(engine) -> None` and append it to MIGRATIONS.
"""
import logging
from collections.abc import Callable

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.schema import CreateIndex, CreateTable

from .db import utcnow

log = logging.getLogger(__name__)


# ---------- 1: multi-exercise workouts (squats, planks) ----------

NEW_WORKOUT_COLUMNS = {
    # name: (Postgres type, SQLite fill value for existing rows)
    "metric_kind": ("VARCHAR(5) NOT NULL DEFAULT 'reps'", "'reps'"),
    "target_hold_ms": ("INTEGER", "NULL"),
    "hold_ms": ("INTEGER", "NULL"),
    "longest_hold_ms": ("INTEGER", "NULL"),
    "hold_score": ("DOUBLE PRECISION", "NULL"),
    "hold_windows": ("JSON", "NULL"),
}
NOW_NULLABLE = ("target_reps", "valid_reps", "attempted_reps", "rep_score")


def m001_multi_exercise(engine: Engine) -> None:
    insp = inspect(engine)
    if "workouts" not in insp.get_table_names():
        return
    cols = {c["name"]: c for c in insp.get_columns("workouts")}
    missing = [c for c in NEW_WORKOUT_COLUMNS if c not in cols]
    not_null = [c for c in NOW_NULLABLE if c in cols and not cols[c]["nullable"]]
    if not missing and not not_null:
        return

    if engine.dialect.name == "postgresql":
        with engine.begin() as conn:
            for name in missing:
                conn.execute(text(f'ALTER TABLE workouts ADD COLUMN IF NOT EXISTS "{name}" {NEW_WORKOUT_COLUMNS[name][0]}'))
            for name in not_null:
                conn.execute(text(f'ALTER TABLE workouts ALTER COLUMN "{name}" DROP NOT NULL'))
        return

    if engine.dialect.name == "sqlite":
        _rebuild_sqlite_workouts(engine, set(cols))
        return

    raise RuntimeError(f"No migration path for {engine.dialect.name}")


def _rebuild_sqlite_workouts(engine: Engine, old_columns: set[str]) -> None:
    """SQLite can't drop NOT NULL in place, so follow its documented table-rebuild
    procedure: new table → copy rows → drop old → rename, with foreign keys off so
    reactions keep pointing at the same workout ids."""
    from .models import Workout

    table = Workout.__table__
    ddl = str(CreateTable(table).compile(dialect=engine.dialect)).strip()
    ddl = ddl.replace("CREATE TABLE workouts ", "CREATE TABLE workouts_new ", 1)
    target_cols = [c.name for c in table.columns]
    select_exprs = [
        f'"{c}"' if c in old_columns else NEW_WORKOUT_COLUMNS.get(c, (None, "NULL"))[1] for c in target_cols
    ]
    indexes = [str(CreateIndex(ix).compile(dialect=engine.dialect)) for ix in table.indexes]

    raw = engine.raw_connection()
    try:
        cur = raw.cursor()
        cur.execute("PRAGMA foreign_keys=OFF")  # must be outside a transaction
        cur.execute("BEGIN")
        try:
            before = cur.execute("SELECT COUNT(*) FROM workouts").fetchone()[0]
            cur.execute("DROP TABLE IF EXISTS workouts_new")
            cur.execute(ddl)
            cur.execute(
                f"INSERT INTO workouts_new ({', '.join(chr(34) + c + chr(34) for c in target_cols)}) "
                f"SELECT {', '.join(select_exprs)} FROM workouts"
            )
            cur.execute("DROP TABLE workouts")
            cur.execute("ALTER TABLE workouts_new RENAME TO workouts")
            for ix in indexes:
                cur.execute(ix)
            after = cur.execute("SELECT COUNT(*) FROM workouts").fetchone()[0]
            problems = cur.execute("PRAGMA foreign_key_check").fetchall()
            if after != before or problems:
                raise RuntimeError(f"workouts rebuild check failed: {before}→{after} rows, fk problems {problems[:3]}")
            cur.execute("COMMIT")
            log.info("Migrated workouts table (%d rows) to the multi-exercise schema", after)
        except Exception:
            cur.execute("ROLLBACK")
            raise
        finally:
            cur.execute("PRAGMA foreign_keys=ON")
    finally:
        raw.close()


MIGRATIONS: list[tuple[int, str, Callable[[Engine], None]]] = [
    (1, "multi_exercise_workouts", m001_multi_exercise),
]


def run_migrations(engine: Engine) -> list[int]:
    """Apply pending migrations in order. Returns the versions applied."""
    with engine.begin() as conn:
        conn.execute(
            text(
                "CREATE TABLE IF NOT EXISTS schema_migrations "
                "(version INTEGER PRIMARY KEY, name VARCHAR(100) NOT NULL, applied_at VARCHAR(40) NOT NULL)"
            )
        )
        done = {row[0] for row in conn.execute(text("SELECT version FROM schema_migrations"))}
    applied = []
    for version, name, fn in MIGRATIONS:
        if version in done:
            continue
        log.info("Applying migration %d: %s", version, name)
        fn(engine)
        with engine.begin() as conn:
            conn.execute(
                text("INSERT INTO schema_migrations (version, name, applied_at) VALUES (:v, :n, :t)"),
                {"v": version, "n": name, "t": utcnow().isoformat()},
            )
        applied.append(version)
    return applied
