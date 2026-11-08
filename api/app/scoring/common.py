"""Scoring helpers shared by every exercise (mirror of web/src/exercises/shared/repScoring.ts)."""
import math
from dataclasses import dataclass, field
from statistics import fmean, pstdev
from typing import Any


def round1(v: float) -> float:
    """Round half up to one decimal, like JavaScript's Math.round(v * 10) / 10."""
    return math.floor(v * 10 + 0.5) / 10


def round2(v: float) -> float:
    return math.floor(v * 100 + 0.5) / 100


def ramp(value: float, best: float, worst: float) -> float:
    """100 at `best`, 0 at `worst`, linear between, clamped. Works in either direction."""
    if best == worst:
        return 100.0 if value == best else 0.0
    return max(0.0, min(100.0, (value - worst) / (best - worst) * 100))


def weighted_form(components: dict[str, float], weights: dict[str, float]) -> float:
    return round1(sum(components.get(k, 0.0) * w for k, w in weights.items()))


@dataclass
class RepConfig:
    final_form_weight: float
    final_volume_weight: float
    consistency_weight: float
    consistency_penalty_per_stdev: float
    component_weights: dict[str, float]


@dataclass
class RepSessionScore:
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
    reps: list[dict[str, Any]] = field(default_factory=list)
    kind: str = "reps"

    @property
    def volume_score(self) -> float:
        return self.rep_score


def aggregate_reps(reps: list[dict[str, Any]], target_reps: int, cfg: RepConfig) -> RepSessionScore:
    """`reps` must already carry `valid`, `confidence`, `formScore` and `components`."""
    valid = [r for r in reps if r["valid"]]
    n = len(valid)
    target = max(1, target_reps)
    mean_rep_form = form = confidence = 0.0
    consistency = 100.0
    averages = {k: 0.0 for k in cfg.component_weights}

    if n:
        # Low-confidence reps count for less; mean (not max) + consistency so one great rep can't carry a set.
        weights = [max(0.05, r["confidence"]) for r in valid]
        mean_rep_form = sum(r["formScore"] * w for r, w in zip(valid, weights)) / sum(weights)
        confidence = fmean(r["confidence"] for r in valid)
        if n >= 2:
            sd = pstdev([r["formScore"] for r in valid])
            consistency = max(0.0, min(100.0, 100 - cfg.consistency_penalty_per_stdev * sd))
            form = (1 - cfg.consistency_weight) * mean_rep_form + cfg.consistency_weight * consistency
        else:
            form = mean_rep_form
        averages = {k: round1(fmean(r["components"][k] for r in valid)) for k in cfg.component_weights}

    rep_score = 100 * min(n / target, 1)
    final = cfg.final_form_weight * form + cfg.final_volume_weight * rep_score
    return RepSessionScore(
        valid_reps=n,
        attempted_reps=len(reps),
        target_reps=target,
        mean_rep_form=round1(mean_rep_form),
        consistency=round1(consistency),
        form_score=round1(form),
        rep_score=round1(rep_score),
        final_score=round1(final),
        confidence=round2(confidence),
        component_averages=averages,
        reps=reps,
    )
