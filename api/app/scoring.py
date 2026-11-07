"""Authoritative push-up scoring (mirror of web/src/pose/scoring.ts).

The browser measures each rep (angles, timing, confidence); the server turns those
raw measurements into scores, so the stored score always follows one formula.
Both implementations are tested against shared/scoring-cases.json.
"""
from dataclasses import dataclass
from statistics import fmean, pstdev
from typing import Any

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
# (must match DETECTOR in pushupDetector.ts).
VALID_DEPTH_ANGLE = 105
MIN_REP_DURATION_MS = 350
MIN_CONFIDENCE = 0.25
MAX_VALID_BODY_DEVIATION = 45


def ramp(value: float, best: float, worst: float) -> float:
    if best == worst:
        return 100.0 if value == best else 0.0
    return max(0.0, min(100.0, (value - worst) / (best - worst) * 100))


def components(rep: dict[str, Any]) -> dict[str, float]:
    return {
        "depth": ramp(rep["minElbowAngle"], *DEPTH_RAMP),
        "lockout": ramp(rep["topElbowAngle"], *LOCKOUT_RAMP),
        "alignment": ramp(rep["meanBodyDeviation"], *ALIGNMENT_RAMP),
        "control": ramp(rep["durationMs"], *CONTROL_RAMP),
    }


def rep_form_score(c: dict[str, float]) -> float:
    return round(sum(c[k] * w for k, w in COMPONENT_WEIGHTS.items()), 1)


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


@dataclass
class SessionScore:
    valid_reps: int
    attempted_reps: int
    target_reps: int
    mean_rep_form: float
    consistency: float
    form_score: float
    rep_score: float
    final_score: float
    confidence: float
    component_averages: dict[str, float]
    reps: list[dict[str, Any]]


def score_session(raw_reps: list[dict[str, Any]], target_reps: int = DEFAULT_TARGET_REPS) -> SessionScore:
    reps: list[dict[str, Any]] = []
    for r in raw_reps:
        # The client may mark a rep invalid for reasons we can't see (e.g. lost tracking),
        # but it can never upgrade a rep that fails the server-side rules.
        reason = r.get("invalidReason") if not r.get("valid", True) else None
        reason = reason or server_invalid_reason(r)
        c = components(r)
        reps.append({**r, "valid": reason is None, "invalidReason": reason, "components": c, "formScore": rep_form_score(c)})

    valid = [r for r in reps if r["valid"]]
    n = len(valid)
    target = max(1, target_reps)
    mean_rep_form = consistency_val = form = confidence = 0.0
    consistency_val = 100.0
    averages = {k: 0.0 for k in COMPONENT_WEIGHTS}

    if n:
        weights = [max(0.05, r["confidence"]) for r in valid]
        mean_rep_form = sum(r["formScore"] * w for r, w in zip(valid, weights)) / sum(weights)
        confidence = fmean(r["confidence"] for r in valid)
        if n >= 2:
            sd = pstdev([r["formScore"] for r in valid])
            consistency_val = max(0.0, min(100.0, 100 - CONSISTENCY_PENALTY_PER_STDEV * sd))
            form = (1 - CONSISTENCY_WEIGHT) * mean_rep_form + CONSISTENCY_WEIGHT * consistency_val
        else:
            form = mean_rep_form
        averages = {k: round(fmean(r["components"][k] for r in valid), 1) for k in COMPONENT_WEIGHTS}

    rep_score = 100 * min(n / target, 1)
    final = FINAL_FORM_WEIGHT * form + FINAL_REP_WEIGHT * rep_score
    return SessionScore(
        valid_reps=n,
        attempted_reps=len(reps),
        target_reps=target,
        mean_rep_form=round(mean_rep_form, 1),
        consistency=round(consistency_val, 1),
        form_score=round(form, 1),
        rep_score=round(rep_score, 1),
        final_score=round(final, 1),
        confidence=round(confidence, 2),
        component_averages=averages,
        reps=reps,
    )
