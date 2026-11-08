from collections.abc import Iterator
from datetime import UTC, datetime

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings


class Base(DeclarativeBase):
    pass


def utcnow() -> datetime:
    return datetime.now(UTC)


def as_utc(dt: datetime) -> datetime:
    """SQLite returns naive datetimes; treat them as UTC."""
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt.astimezone(UTC)


def make_engine(url: str) -> Engine:
    if url.startswith("sqlite"):
        engine = create_engine(url, connect_args={"check_same_thread": False})

        @event.listens_for(engine, "connect")
        def _fk_on(dbapi_conn, _):  # enforce ON DELETE CASCADE in SQLite
            dbapi_conn.execute("PRAGMA foreign_keys=ON")

        return engine
    return create_engine(url, pool_pre_ping=True, pool_size=5, max_overflow=5)


engine = make_engine(get_settings().sqlalchemy_url)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def init_db(bind: Engine | None = None) -> None:
    from . import models  # noqa: F401  (register tables)

    from .migrations import run_migrations

    bind = bind or engine
    Base.metadata.create_all(bind)  # creates missing tables; never alters existing ones
    run_migrations(bind)  # brings existing tables up to date, preserving rows
    if bind.dialect.name == "postgresql":
        # Supabase exposes the public schema over its REST API. Enabling RLS with no
        # policies means that API can read nothing; this backend connects as the table
        # owner, which bypasses RLS, so it is unaffected.
        with bind.begin() as conn:
            for table in inspect(bind).get_table_names():
                if table in Base.metadata.tables or table == "schema_migrations":
                    conn.execute(text(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY'))


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
