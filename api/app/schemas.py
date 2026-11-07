from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class CamelModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, from_attributes=True)


# ---------- users ----------

class UserPublic(CamelModel):
    id: int
    username: str
    display_name: str = Field(serialization_alias="displayName")
    avatar_url: str | None = Field(serialization_alias="avatarUrl")
    is_demo: bool = Field(serialization_alias="isDemo")


class Me(UserPublic):
    email: str | None
    created_at: datetime = Field(serialization_alias="createdAt")


class SyncProfileIn(BaseModel):
    """Display hints from the ID token. Used only if Auth0 /userinfo is unreachable."""
    name: str | None = Field(None, max_length=120)
    nickname: str | None = Field(None, max_length=120)
    picture: str | None = Field(None, max_length=1024)


class UpdateMeIn(BaseModel):
    display_name: str | None = Field(None, alias="displayName", min_length=1, max_length=80)
    username: str | None = Field(None, min_length=3, max_length=20, pattern=r"^[a-z0-9_]+$")


# ---------- groups ----------

class GroupCreateIn(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    description: str | None = Field(None, max_length=280)


class JoinGroupIn(BaseModel):
    invite_code: str = Field(alias="inviteCode", min_length=4, max_length=12)

    @field_validator("invite_code")
    @classmethod
    def normalize(cls, v: str) -> str:
        return v.strip().upper()


class RoleIn(BaseModel):
    role: Literal["admin", "member"]


# ---------- workouts ----------

class RepIn(BaseModel):
    """One rep as measured on-device. Field names match the TypeScript RepMeasurement."""
    model_config = ConfigDict(extra="ignore")

    index: int = Field(ge=1, le=1000)
    valid: bool
    invalidReason: str | None = Field(None, max_length=80)
    startMs: int = Field(ge=0, le=4 * 3600 * 1000)
    durationMs: int = Field(ge=0, le=60_000)
    minElbowAngle: float = Field(ge=0, le=180)
    topElbowAngle: float = Field(ge=0, le=180)
    meanBodyDeviation: float = Field(ge=0, le=180)
    maxBodyDeviation: float = Field(ge=0, le=180)
    hipFault: Literal["sag", "pike"] | None = None
    confidence: float = Field(ge=0, le=1)
    usedKneesForAlignment: bool = False


class WorkoutCreateIn(BaseModel):
    exercise: Literal["pushup"] = "pushup"
    source: Literal["camera", "demo"]
    visibility: Literal["groups", "private"] = "groups"
    started_at: datetime = Field(alias="startedAt")
    duration_ms: int = Field(alias="durationMs", ge=1000, le=4 * 3600 * 1000)
    target_reps: int = Field(20, alias="targetReps", ge=1, le=200)
    reps: list[RepIn] = Field(max_length=500)
    note: str | None = Field(None, max_length=280)


class WorkoutPatchIn(BaseModel):
    visibility: Literal["groups", "private"] | None = None
    note: str | None = Field(None, max_length=280)


class ReactionIn(BaseModel):
    kind: Literal["strong", "fire", "clap", "form"]


class CalendarDay(BaseModel):
    date: date
    workouts: int
    reps: int
    level: int  # 0–4 intensity for the heatmap
