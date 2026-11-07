/**
 * Push-up scoring. Pure functions, no detection logic.
 *
 * The backend (api/app/scoring.py) implements the same model and is the
 * authority for stored scores; both are checked against
 * shared/scoring-cases.json so they cannot drift apart.
 */
import { clamp, mean, stdev } from './geometry'
import type { FormComponents, RepMeasurement, ScoredRep } from './types'

export const SCORING_VERSION = 1

export const SCORING = {
  /** S = finalFormWeight·F + finalRepWeight·R */
  finalFormWeight: 0.7,
  finalRepWeight: 0.3,
  defaultTargetReps: 20,
  /** Per-rep form score weights (sum to 1). */
  componentWeights: { depth: 0.4, lockout: 0.15, alignment: 0.35, control: 0.1 },
  /** Session form F = (1-w)·confidence-weighted mean + w·consistency. */
  consistencyWeight: 0.15,
  /** Each point of standard deviation between rep scores costs this much consistency. */
  consistencyPenaltyPerStdev: 2.5,
  // Linear ramps: [value scoring 100, value scoring 0]
  depthRamp: [85, 115] as const, // deepest elbow angle, degrees (lower is better)
  lockoutRamp: [165, 150] as const, // top elbow angle, degrees (higher is better)
  alignmentRamp: [8, 35] as const, // mean body-line deviation, degrees (lower is better)
  controlRamp: [800, 400] as const, // rep duration, ms (slower is better, up to 800ms)
}

/** Linear score: 100 at `best`, 0 at `worst`, clamped. Works in either direction. */
export function ramp(value: number, best: number, worst: number): number {
  if (best === worst) return value === best ? 100 : 0
  return clamp(((value - worst) / (best - worst)) * 100, 0, 100)
}

export function scoreComponents(m: RepMeasurement): FormComponents {
  return {
    depth: ramp(m.minElbowAngle, ...SCORING.depthRamp),
    lockout: ramp(m.topElbowAngle, ...SCORING.lockoutRamp),
    alignment: ramp(m.meanBodyDeviation, ...SCORING.alignmentRamp),
    control: ramp(m.durationMs, ...SCORING.controlRamp),
  }
}

export function scoreRep(m: RepMeasurement): ScoredRep {
  const components = scoreComponents(m)
  const w = SCORING.componentWeights
  const formScore =
    components.depth * w.depth +
    components.lockout * w.lockout +
    components.alignment * w.alignment +
    components.control * w.control
  return { ...m, components, formScore: round1(formScore) }
}

export interface SessionScore {
  validReps: number
  attemptedReps: number
  targetReps: number
  /** Confidence-weighted mean of valid rep form scores. */
  meanRepForm: number
  /** 100 = every rep scored the same. */
  consistency: number
  /** F — session form score, 0–100. */
  formScore: number
  /** R — repetition score, 0–100. */
  repScore: number
  /** S — final score, 0–100. */
  finalScore: number
  /** Mean confidence over valid reps, 0–1. */
  confidence: number
  /** Averages of each component over valid reps, for the explanation UI. */
  componentAverages: FormComponents
}

export function scoreSession(reps: ScoredRep[], targetReps = SCORING.defaultTargetReps): SessionScore {
  const valid = reps.filter((r) => r.valid)
  const n = valid.length
  const target = Math.max(1, targetReps)

  let meanRepForm = 0
  let consistency = 100
  let formScore = 0
  let confidence = 0
  const componentAverages: FormComponents = { depth: 0, lockout: 0, alignment: 0, control: 0 }

  if (n > 0) {
    // Low-confidence reps count for less: we're less sure what we saw.
    const weights = valid.map((r) => Math.max(0.05, r.confidence))
    const wSum = weights.reduce((s, w) => s + w, 0)
    meanRepForm = valid.reduce((s, r, i) => s + r.formScore * weights[i], 0) / wSum
    confidence = mean(valid.map((r) => r.confidence))

    // Mean (not max) plus a consistency term: one great rep can't carry a sloppy set.
    if (n >= 2) {
      consistency = clamp(100 - SCORING.consistencyPenaltyPerStdev * stdev(valid.map((r) => r.formScore)), 0, 100)
      formScore = (1 - SCORING.consistencyWeight) * meanRepForm + SCORING.consistencyWeight * consistency
    } else {
      formScore = meanRepForm
    }

    for (const key of Object.keys(componentAverages) as (keyof FormComponents)[]) {
      componentAverages[key] = round1(mean(valid.map((r) => r.components[key])))
    }
  }

  const repScore = 100 * Math.min(n / target, 1)
  const finalScore = SCORING.finalFormWeight * formScore + SCORING.finalRepWeight * repScore

  return {
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

/** Plain-language reasons behind a session score, worst first. */
export function explainSession(s: SessionScore, reps: ScoredRep[]): string[] {
  const valid = reps.filter((r) => r.valid)
  if (valid.length === 0) return ['No complete reps were detected, so there is no form score yet.']
  const lines: { score: number; text: string }[] = []
  const avg = (f: (r: ScoredRep) => number) => Math.round(mean(valid.map(f)))
  const c = s.componentAverages

  lines.push({
    score: c.depth,
    text:
      c.depth >= 80
        ? `Good depth — your elbows averaged ${avg((r) => r.minElbowAngle)}° at the bottom.`
        : `Depth cost points — your elbows averaged ${avg((r) => r.minElbowAngle)}° at the bottom. Aim for about 90° or lower.`,
  })
  const sags = valid.filter((r) => r.hipFault === 'sag').length
  const pikes = valid.filter((r) => r.hipFault === 'pike').length
  lines.push({
    score: c.alignment,
    text:
      c.alignment >= 80
        ? `Your body stayed in a straight line (about ${avg((r) => r.meanBodyDeviation)}° off).`
        : sags >= pikes
          ? `Hips dropped on ${sags} of ${valid.length} reps. Squeeze your glutes and brace your core.`
          : `Hips were piked up on ${pikes} of ${valid.length} reps. Lower them in line with your shoulders.`,
  })
  lines.push({
    score: c.lockout,
    text:
      c.lockout >= 80
        ? 'Arms fully extended at the top.'
        : 'Straighten your arms fully at the top of each rep.',
  })
  lines.push({
    score: c.control,
    text: c.control >= 80 ? 'Controlled tempo.' : 'Some reps were rushed. Slow down to about one second per rep.',
  })
  if (valid.length >= 2) {
    lines.push({
      score: s.consistency,
      text:
        s.consistency >= 80
          ? 'Your reps were consistent from first to last.'
          : 'Form changed a lot between reps — later reps may have been fatigued.',
    })
  }
  const invalid = reps.length - valid.length
  if (invalid > 0) {
    lines.push({ score: 0, text: `${invalid} rep${invalid === 1 ? '' : 's'} didn't count (shown in the rep list).` })
  }
  return lines.sort((a, b) => a.score - b.score).map((l) => l.text)
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}
