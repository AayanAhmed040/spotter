"""Squat scoring (mirror of web/src/exercises/squats/scoring.ts and config.ts)."""
from typing import Any

from .common import RepConfig, RepSessionScore, aggregate_reps, ramp, weighted_form

SCORING_VERSION = 1
DEFAULT_TARGET_REPS = 20
COMPONENT_WEIGHTS = {"depth": 0.45, "torso": 0.25, "lockout": 0.15, "control": 0.15}
DEPTH_RAMP = (70, 115)
TORSO_RAMP = (40, 65)
LOCKOUT_RAMP = (172, 158)
CONTROL_RAMP = (1200, 600)

VALID_DEPTH_ANGLE = 105
MIN_REP_DURATION_MS = 500
MIN_CONFIDENCE = 0.25
MAX_VALID_TORSO_LEAN = 70

CONFIG = RepConfig(
    final_form_weight=0.7,
    final_volume_weight=0.3,
    consistency_weight=0.15,
    consistency_penalty_per_stdev=2.5,
    component_weights=COMPONENT_WEIGHTS,
)


def components(rep: dict[str, Any]) -> dict[str, float]:
    return {
        "depth": ramp(rep["minKneeAngle"], *DEPTH_RAMP),
        "torso": ramp(rep["maxTorsoLean"], *TORSO_RAMP),
        "lockout": ramp(rep["topKneeAngle"], *LOCKOUT_RAMP),
        "control": ramp(rep["durationMs"], *CONTROL_RAMP),
    }


def server_invalid_reason(rep: dict[str, Any]) -> str | None:
    if rep["minKneeAngle"] > VALID_DEPTH_ANGLE:
        return "Not deep enough"
    if rep["durationMs"] < MIN_REP_DURATION_MS:
        return "Too fast to track reliably"
    if rep["confidence"] < MIN_CONFIDENCE:
        return "Low tracking confidence"
    if rep["meanTorsoLean"] > MAX_VALID_TORSO_LEAN:
        return "Bent over instead of squatting"
    return None


def score_session(raw_reps: list[dict[str, Any]], target_reps: int = DEFAULT_TARGET_REPS) -> RepSessionScore:
    reps = []
    for r in raw_reps:
        reason = (r.get("invalidReason") or "Invalid") if not r.get("valid", True) else server_invalid_reason(r)
        c = components(r)
        reps.append({**r, "valid": reason is None, "invalidReason": reason, "components": c, "formScore": weighted_form(c, COMPONENT_WEIGHTS)})
    return aggregate_reps(reps, target_reps, CONFIG)
