"""Push-up scoring (mirror of web/src/exercises/pushups/scoring.ts).

The browser measures each rep (angles, timing, confidence); the server turns those
raw measurements into scores, so the stored score always follows one formula.
"""
from typing import Any

from .common import RepConfig, RepSessionScore, aggregate_reps, ramp, weighted_form

SCORING_VERSION = 1

FINAL_FORM_WEIGHT = 0.7
FINAL_REP_WEIGHT = 0.3
DEFAULT_TARGET_REPS = 20
COMPONENT_WEIGHTS = {"depth": 0.4, "lockout": 0.15, "alignment": 0.35, "control": 0.1}
CONSISTENCY_WEIGHT = 0.15
CONSISTENCY_PENALTY_PER_STDEV = 2.5
DEPTH_RAMP = (85, 115)
LOCKOUT_RAMP = (165, 150)
ALIGNMENT_RAMP = (8, 35)
CONTROL_RAMP = (800, 400)

# Validity rules the server can re-check from measurements alone
# (must match DETECTOR in web/src/exercises/pushups/detector.ts).
VALID_DEPTH_ANGLE = 105
MIN_REP_DURATION_MS = 350
MIN_CONFIDENCE = 0.25
MAX_VALID_BODY_DEVIATION = 45

CONFIG = RepConfig(
    final_form_weight=FINAL_FORM_WEIGHT,
    final_volume_weight=FINAL_REP_WEIGHT,
    consistency_weight=CONSISTENCY_WEIGHT,
    consistency_penalty_per_stdev=CONSISTENCY_PENALTY_PER_STDEV,
    component_weights=COMPONENT_WEIGHTS,
)

SessionScore = RepSessionScore


def components(rep: dict[str, Any]) -> dict[str, float]:
    return {
        "depth": ramp(rep["minElbowAngle"], *DEPTH_RAMP),
        "lockout": ramp(rep["topElbowAngle"], *LOCKOUT_RAMP),
        "alignment": ramp(rep["meanBodyDeviation"], *ALIGNMENT_RAMP),
        "control": ramp(rep["durationMs"], *CONTROL_RAMP),
    }


def rep_form_score(c: dict[str, float]) -> float:
    return weighted_form(c, COMPONENT_WEIGHTS)


def server_invalid_reason(rep: dict[str, Any]) -> str | None:
    if rep["minElbowAngle"] > VALID_DEPTH_ANGLE:
        return "Not deep enough"
    if rep["durationMs"] < MIN_REP_DURATION_MS:
        return "Too fast to track reliably"
    if rep["confidence"] < MIN_CONFIDENCE:
        return "Low tracking confidence"
    if rep["meanBodyDeviation"] > MAX_VALID_BODY_DEVIATION:
        return "Body not in a plank"
    return None


def score_session(raw_reps: list[dict[str, Any]], target_reps: int = DEFAULT_TARGET_REPS) -> RepSessionScore:
    reps = []
    for r in raw_reps:
        # The client may mark a rep invalid for reasons we can't see (e.g. lost tracking),
        # but it can never upgrade a rep that fails the server-side rules.
        reason = (r.get("invalidReason") or "Invalid") if not r.get("valid", True) else server_invalid_reason(r)
        c = components(r)
        reps.append({**r, "valid": reason is None, "invalidReason": reason, "components": c, "formScore": rep_form_score(c)})
    return aggregate_reps(reps, target_reps, CONFIG)
