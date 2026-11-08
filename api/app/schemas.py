from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


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

class PushupRepIn(BaseModel):
    """One push-up as measured on-device. Field names match the TypeScript RepMeasurement."""
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


RepIn = PushupRepIn  # backwards-compatible name


class SquatRepIn(BaseModel):
    """One squat as measured on-device (web/src/exercises/squats/types.ts)."""
    model_config = ConfigDict(extra="ignore")

    index: int = Field(ge=1, le=1000)
    valid: bool
    invalidReason: str | None = Field(None, max_length=80)
    startMs: int = Field(ge=0, le=4 * 3600 * 1000)
    durationMs: int = Field(ge=0, le=60_000)
    minKneeAngle: float = Field(ge=0, le=180)
    topKneeAngle: float = Field(ge=0, le=180)
    maxTorsoLean: float = Field(ge=0, le=180)
    meanTorsoLean: float = Field(ge=0, le=180)
    reachedParallel: bool = False
    frontView: bool = False
    confidence: float = Field(ge=0, le=1)


class HoldWindowIn(BaseModel):
    """A ≤5 s slice of a plank hold (web/src/exercises/shared/types.ts HoldWindow)."""
    model_config = ConfigDict(extra="ignore")

    segment: int = Field(ge=0, le=1000)
    startMs: int = Field(ge=0, le=4 * 3600 * 1000)
    durationMs: int = Field(ge=0, le=6_000)
    meanBodyDeviation: float = Field(ge=0, le=180)
    meanStackOffset: float = Field(ge=0, le=5)
    hipSway: float = Field(ge=0, le=1)
    sagShare: float = Field(ge=0, le=1)
    pikeShare: float = Field(ge=0, le=1)
    confidence: float = Field(ge=0, le=1)


REP_MODELS: dict[str, type[BaseModel]] = {"pushup": PushupRepIn, "squat": SquatRepIn}


class WorkoutCreateIn(BaseModel):
    exercise: Literal["pushup", "squat", "plank"] = "pushup"
    source: Literal["camera", "demo"] = "camera"
    visibility: Literal["groups", "private"] = "groups"
    started_at: datetime = Field(alias="startedAt")
    duration_ms: int = Field(alias="durationMs", ge=1000, le=4 * 3600 * 1000)
    # Rep exercises
    target_reps: int | None = Field(None, alias="targetReps", ge=1, le=200)
    reps: list[dict[str, Any]] | None = Field(None, max_length=500)
    # Hold exercises
    target_hold_ms: int | None = Field(None, alias="targetHoldMs", ge=5_000, le=3600 * 1000)
    hold_windows: list[HoldWindowIn] | None = Field(None, alias="holdWindows", max_length=2880)
    note: str | None = Field(None, max_length=280)

    @model_validator(mode="after")
    def check_shape(self) -> "WorkoutCreateIn":
        if self.exercise in REP_MODELS:
            if self.reps is None or self.hold_windows is not None:
                raise ValueError(f"{self.exercise} workouts need `reps` and no `holdWindows`")
            model = REP_MODELS[self.exercise]
            # Validate every rep against the exercise's own measurement schema.
            self.reps = [model.model_validate(r).model_dump() for r in self.reps]
        else:
            if self.hold_windows is None or self.reps is not None:
                raise ValueError(f"{self.exercise} workouts need `holdWindows` and no `reps`")
            held = sum(w.durationMs for w in self.hold_windows)
            if held > self.duration_ms + 2_000:
                raise ValueError("Hold time can't exceed the workout duration")
        return self


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
