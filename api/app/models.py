"""Database schema.

Identity lives in Auth0; `users.auth0_sub` is the only link to it. Everything a
user is *allowed* to do is decided here (group roles, ownership), not in Auth0.
"""
from datetime import date, datetime
from typing import Any

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base, utcnow

# Workout sources:
#   camera — analysed live by MediaPipe on the user's device
#   demo   — the labelled simulator; shown in feeds, excluded from leaderboards/challenges
#   seed   — sample history for demo accounts
COMPETITIVE_SOURCES = ("camera", "seed")


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    auth0_sub: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    username: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(80))
    avatar_url: Mapped[str | None] = mapped_column(String(1024))
    email: Mapped[str | None] = mapped_column(String(320))
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    memberships: Mapped[list["GroupMember"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Group(Base):
    __tablename__ = "groups"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(60))
    description: Mapped[str | None] = mapped_column(String(280))
    invite_code: Mapped[str] = mapped_column(String(12), unique=True, index=True)
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    members: Mapped[list["GroupMember"]] = relationship(back_populates="group", cascade="all, delete-orphan")
    challenges: Mapped[list["Challenge"]] = relationship(back_populates="group", cascade="all, delete-orphan")


class GroupMember(Base):
    __tablename__ = "group_members"
    __table_args__ = (UniqueConstraint("group_id", "user_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(10), default="member")  # owner | admin | member
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    group: Mapped[Group] = relationship(back_populates="members")
    user: Mapped[User] = relationship(back_populates="memberships")


class Workout(Base):
    __tablename__ = "workouts"
    __table_args__ = (Index("ix_workouts_user_started", "user_id", "started_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    exercise: Mapped[str] = mapped_column(String(20), default="pushup")
    source: Mapped[str] = mapped_column(String(10), default="camera")
    visibility: Mapped[str] = mapped_column(String(10), default="groups")  # groups | private
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    duration_ms: Mapped[int] = mapped_column(Integer)
    target_reps: Mapped[int] = mapped_column(Integer, default=20)

    # Derived scores (recomputed server-side from rep_metrics; see scoring.py)
    valid_reps: Mapped[int] = mapped_column(Integer)
    attempted_reps: Mapped[int] = mapped_column(Integer)
    form_score: Mapped[float] = mapped_column(Float)
    rep_score: Mapped[float] = mapped_column(Float)
    final_score: Mapped[float] = mapped_column(Float)
    consistency: Mapped[float] = mapped_column(Float)
    confidence: Mapped[float] = mapped_column(Float)
    scoring_version: Mapped[int] = mapped_column(Integer)
    component_averages: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    # Raw per-rep measurements exactly as measured on-device. No video is ever stored.
    rep_metrics: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    note: Mapped[str | None] = mapped_column(String(280))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    user: Mapped[User] = relationship()
    reactions: Mapped[list["Reaction"]] = relationship(back_populates="workout", cascade="all, delete-orphan")


class Reaction(Base):
    __tablename__ = "reactions"
    __table_args__ = (UniqueConstraint("workout_id", "user_id", "kind"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    workout_id: Mapped[int] = mapped_column(ForeignKey("workouts.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(12))  # strong | fire | clap | form
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    workout: Mapped[Workout] = relationship(back_populates="reactions")
    user: Mapped[User] = relationship()


class Challenge(Base):
    """A collective group goal: every member's valid reps add to one total."""

    __tablename__ = "challenges"

    id: Mapped[int] = mapped_column(primary_key=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(80))
    description: Mapped[str] = mapped_column(Text)
    exercise: Mapped[str] = mapped_column(String(20), default="pushup")
    goal_reps: Mapped[int] = mapped_column(Integer)
    min_sessions_per_member: Mapped[int] = mapped_column(Integer, default=1)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    difficulty: Mapped[str] = mapped_column(String(10), default="moderate")
    source: Mapped[str] = mapped_column(String(10), default="gemini")  # gemini | rules
    ai_model: Mapped[str | None] = mapped_column(String(60))
    rationale: Mapped[str | None] = mapped_column(Text)
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    group: Mapped[Group] = relationship(back_populates="challenges")


class Insight(Base):
    """Cached weekly AI summary — one per user per ISO week, to respect rate limits."""

    __tablename__ = "insights"
    __table_args__ = (UniqueConstraint("user_id", "week_start"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    week_start: Mapped[date] = mapped_column(Date)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)
    source: Mapped[str] = mapped_column(String(10))  # gemini | rules
    ai_model: Mapped[str | None] = mapped_column(String(60))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
