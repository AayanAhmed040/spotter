/**
 * Push-up scoring. Pure functions, no detection logic.
 *
 * The backend (api/app/scoring/pushup.py) implements the same model and is the
 * authority for stored scores; both are checked against shared/scoring-cases.json.
 */
import { mean } from '../shared/geometry'
import { ramp, scoreRepSession, weightedForm, type RepSessionScore } from '../shared/repScoring'
import type { FormComponents, RepMeasurement, ScoredRep } from './types'

export { ramp } from '../shared/repScoring'

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

export function scoreComponents(m: RepMeasurement): FormComponents {
  return {
    depth: ramp(m.minElbowAngle, ...SCORING.depthRamp),
    lockout: ramp(m.topElbowAngle, ...SCORING.lockoutRamp),
    alignment: ramp(m.meanBodyDeviation, ...SCORING.alignmentRamp),
    control: ramp(m.durationMs, ...SCORING.controlRamp),
  }
}

/**
 * Rules the server re-applies to every submitted rep (it can downgrade a rep,
 * never upgrade one). Applied to the on-device preview too, so both agree.
 */
export function revalidate(m: RepMeasurement): RepMeasurement {
  const reason = !m.valid
    ? m.invalidReason
    : m.minElbowAngle > 105
      ? 'Not deep enough'
      : m.durationMs < 350
        ? 'Too fast to track reliably'
        : m.confidence < 0.25
          ? 'Low tracking confidence'
          : m.meanBodyDeviation > 45
            ? 'Body not in a plank'
            : null
  return { ...m, valid: reason === null, invalidReason: reason }
}

export function scoreRep(m: RepMeasurement): ScoredRep {
  const components = scoreComponents(m)
  return { ...m, components, formScore: weightedForm(components, SCORING.componentWeights) }
}

export type SessionScore = RepSessionScore

export function scoreSession(reps: ScoredRep[], targetReps = SCORING.defaultTargetReps): SessionScore {
  return scoreRepSession(reps, targetReps, {
    finalFormWeight: SCORING.finalFormWeight,
    finalVolumeWeight: SCORING.finalRepWeight,
    consistencyWeight: SCORING.consistencyWeight,
    consistencyPenaltyPerStdev: SCORING.consistencyPenaltyPerStdev,
    componentWeights: SCORING.componentWeights,
  })
}

/** Plain-language reasons behind a session score, worst first. */
export function explainSession(s: SessionScore, reps: ScoredRep[]): string[] {
  const valid = reps.filter((r) => r.valid)
  if (valid.length === 0) return ['No complete push-ups were detected, so there is no form score yet.']
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
    text: c.lockout >= 80 ? 'Arms fully extended at the top.' : 'Straighten your arms fully at the top of each rep.',
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
