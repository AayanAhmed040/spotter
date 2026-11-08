/**
 * Session aggregation shared by every rep exercise. Each exercise supplies its
 * own per-rep components; this turns scored reps into a session score:
 *
 *   F = (1 − c)·confidence-weighted mean rep form + c·consistency
 *   R = 100 × min(valid reps ÷ target, 1)
 *   S = wF·F + wR·R
 *
 * Mirrored in api/app/scoring/common.py.
 */
import { clamp, mean, stdev } from './geometry'
import { round1 } from './signal'
import type { RepBase, Scored } from './types'

export interface RepSessionConfig {
  finalFormWeight: number
  finalVolumeWeight: number
  consistencyWeight: number
  consistencyPenaltyPerStdev: number
  componentWeights: Record<string, number>
}

export interface RepSessionScore {
  kind: 'reps'
  validReps: number
  attemptedReps: number
  targetReps: number
  /** Confidence-weighted mean of valid rep form scores. */
  meanRepForm: number
  /** 100 = every rep scored the same. */
  consistency: number
  /** F — session form score, 0–100. */
  formScore: number
  /** R — repetition score, 0–100. Kept as `repScore` for backwards compatibility. */
  repScore: number
  /** S — final score, 0–100. */
  finalScore: number
  confidence: number
  componentAverages: Record<string, number>
}

/** Linear score: 100 at `best`, 0 at `worst`, clamped. Works in either direction. */
export function ramp(value: number, best: number, worst: number): number {
  if (best === worst) return value === best ? 100 : 0
  return clamp(((value - worst) / (best - worst)) * 100, 0, 100)
}

export function weightedForm(components: Record<string, number>, weights: Record<string, number>): number {
  return round1(Object.entries(weights).reduce((s, [k, w]) => s + (components[k] ?? 0) * w, 0))
}

export function scoreRepSession<R extends RepBase>(
  reps: Scored<R>[],
  targetReps: number,
  cfg: RepSessionConfig,
): RepSessionScore {
  const valid = reps.filter((r) => r.valid)
  const n = valid.length
  const target = Math.max(1, targetReps)
  const componentAverages: Record<string, number> = Object.fromEntries(Object.keys(cfg.componentWeights).map((k) => [k, 0]))

  let meanRepForm = 0
  let consistency = 100
  let formScore = 0
  let confidence = 0

  if (n > 0) {
    // Low-confidence reps count for less: we're less sure what we saw.
    const weights = valid.map((r) => Math.max(0.05, r.confidence))
    const wSum = weights.reduce((s, w) => s + w, 0)
    meanRepForm = valid.reduce((s, r, i) => s + r.formScore * weights[i], 0) / wSum
    confidence = mean(valid.map((r) => r.confidence))
    // Mean (not max) plus a consistency term: one great rep can't carry a sloppy set.
    if (n >= 2) {
      consistency = clamp(100 - cfg.consistencyPenaltyPerStdev * stdev(valid.map((r) => r.formScore)), 0, 100)
      formScore = (1 - cfg.consistencyWeight) * meanRepForm + cfg.consistencyWeight * consistency
    } else {
      formScore = meanRepForm
    }
    for (const key of Object.keys(componentAverages)) {
      componentAverages[key] = round1(mean(valid.map((r) => r.components[key] ?? 0)))
    }
  }

  const repScore = 100 * Math.min(n / target, 1)
  const finalScore = cfg.finalFormWeight * formScore + cfg.finalVolumeWeight * repScore

  return {
    kind: 'reps',
    validReps: n,
    attemptedReps: reps.length,
    targetReps: target,
    meanRepForm: round1(meanRepForm),
    consistency: round1(consistency),
    formScore: round1(formScore),
    repScore: round1(repScore),
    finalScore: round1(finalScore),
    confidence: Math.round(confidence * 100) / 100,
    componentAverages,
  }
}
