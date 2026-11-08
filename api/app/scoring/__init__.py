"""Authoritative workout scoring, one module per exercise.

Each module mirrors web/src/exercises/<exercise>/scoring.ts; both are tested
against shared/scoring-cases.json so they cannot drift apart.
"""
from typing import Literal

from . import plank, pushup, squat
from .common import RepSessionScore
from .plank import HoldSessionScore

# Backwards-compatible names (push-ups were the only exercise in scoring v1).
from .pushup import FINAL_FORM_WEIGHT, FINAL_REP_WEIGHT, SCORING_VERSION, score_session  # noqa: F401

ExerciseId = Literal["pushup", "squat", "plank"]

REP_EXERCISES: dict[str, object] = {"pushup": pushup, "squat": squat}
HOLD_EXERCISES: dict[str, object] = {"plank": plank}
EXERCISES = ("pushup", "squat", "plank")
METRIC_KIND = {"pushup": "reps", "squat": "reps", "plank": "hold"}
SCORING_VERSIONS = {"pushup": pushup.SCORING_VERSION, "squat": squat.SCORING_VERSION, "plank": plank.SCORING_VERSION}


def score_reps(exercise: str, reps: list[dict], target_reps: int) -> RepSessionScore:
    return REP_EXERCISES[exercise].score_session(reps, target_reps)  # type: ignore[attr-defined]


def score_hold(exercise: str, windows: list[dict], target_hold_ms: int) -> HoldSessionScore:
    return HOLD_EXERCISES[exercise].score_hold(windows, target_hold_ms)  # type: ignore[attr-defined]
