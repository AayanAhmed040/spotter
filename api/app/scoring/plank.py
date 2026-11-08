"""Plank scoring (mirror of web/src/exercises/planks/scoring.ts).

The browser summarises the hold into ≤5 s windows of raw measurements. Only
windows that were clearly tracked and in a valid plank count as hold time.

    F = 0.85 × time-and-confidence-weighted window form + 0.15 × consistency
    T = 100 × min(valid hold ÷ target, 1)
    S = 0.7F + 0.3T
"""
from dataclasses import dataclass, field
from statistics import pstdev
from typing import Any

from .common import ramp, round1, round2, weighted_form

SCORING_VERSION = 1
DEFAULT_TARGET_MS = 60_000
FINAL_FORM_WEIGHT = 0.7
FINAL_HOLD_WEIGHT = 0.3
COMPONENT_WEIGHTS = {"alignment": 0.6, "stability": 0.25, "stack": 0.15}
CONSISTENCY_WEIGHT = 0.15
CONSISTENCY_PENALTY_PER_STDEV = 2.5
MIN_WINDOW_CONFIDENCE = 0.4
MAX_VALID_DEVIATION = 28
ALIGNMENT_RAMP = (6, 25)
STABILITY_RAMP = (0.006, 0.03)
STACK_RAMP = (0.25, 0.75)


@dataclass
class HoldSessionScore:
    hold_ms: int
    longest_hold_ms: int
    target_hold_ms: int
    mean_window_form: float
    consistency: float
    form_score: float
    hold_score: float
    final_score: float
    confidence: float
    component_averages: dict[str, float]
    discarded_ms: int
    windows: list[dict[str, Any]] = field(default_factory=list)
    kind: str = "hold"

    @property
    def volume_score(self) -> float:
        return self.hold_score


def components(w: dict[str, Any]) -> dict[str, float]:
    return {
        "alignment": ramp(w["meanBodyDeviation"], *ALIGNMENT_RAMP),
        "stability": ramp(w["hipSway"], *STABILITY_RAMP),
        "stack": ramp(w["meanStackOffset"], *STACK_RAMP),
    }


def window_counts(w: dict[str, Any]) -> bool:
    return w["confidence"] >= MIN_WINDOW_CONFIDENCE and w["meanBodyDeviation"] <= MAX_VALID_DEVIATION and w["durationMs"] > 0


def score_hold(windows: list[dict[str, Any]], target_hold_ms: int = DEFAULT_TARGET_MS) -> HoldSessionScore:
    scored = []
    for w in windows:
        c = components(w)
        scored.append({**w, "components": c, "formScore": weighted_form(c, COMPONENT_WEIGHTS), "counted": window_counts(w)})
    counted = [w for w in scored if w["counted"]]
    target = max(1000, target_hold_ms)
    hold = sum(w["durationMs"] for w in counted)
    discarded = sum(w["durationMs"] for w in scored) - hold

    by_segment: dict[int, int] = {}
    for w in counted:
        by_segment[w["segment"]] = by_segment.get(w["segment"], 0) + w["durationMs"]
    longest = max(by_segment.values(), default=0)

    averages = {k: 0.0 for k in COMPONENT_WEIGHTS}
    mean_form = form = confidence = 0.0
    consistency = 100.0
    if counted:
        weights = [w["durationMs"] * max(0.05, w["confidence"]) for w in counted]
        mean_form = sum(w["formScore"] * wt for w, wt in zip(counted, weights)) / sum(weights)
        confidence = sum(w["confidence"] * w["durationMs"] for w in counted) / hold
        if len(counted) >= 2:
            consistency = max(0.0, min(100.0, 100 - CONSISTENCY_PENALTY_PER_STDEV * pstdev([w["formScore"] for w in counted])))
            form = (1 - CONSISTENCY_WEIGHT) * mean_form + CONSISTENCY_WEIGHT * consistency
        else:
            form = mean_form
        averages = {k: round1(sum(w["components"][k] * w["durationMs"] for w in counted) / hold) for k in COMPONENT_WEIGHTS}

    hold_score = 100 * min(hold / target, 1)
    final = FINAL_FORM_WEIGHT * form + FINAL_HOLD_WEIGHT * hold_score
    return HoldSessionScore(
        hold_ms=round(hold),
        longest_hold_ms=round(longest),
        target_hold_ms=target,
        mean_window_form=round1(mean_form),
        consistency=round1(consistency),
        form_score=round1(form),
        hold_score=round1(hold_score),
        final_score=round1(final),
        confidence=round2(confidence),
        component_averages=averages,
        discarded_ms=round(discarded),
        windows=scored,
    )
