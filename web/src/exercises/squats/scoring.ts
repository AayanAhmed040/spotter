/** Squat scoring (mirrored in api/app/scoring/squat.py). */
import { mean } from '../shared/geometry'
import { ramp, scoreRepSession, weightedForm, type RepSessionScore } from '../shared/repScoring'
import { SQUAT_DETECTOR, SQUAT_SCORING as S } from './config'
import type { ScoredSquatRep, SquatComponents, SquatRep } from './types'

export function scoreSquatComponents(r: SquatRep): SquatComponents {
  return {
    depth: ramp(r.minKneeAngle, ...S.depthRamp),
    torso: ramp(r.maxTorsoLean, ...S.torsoRamp),
    lockout: ramp(r.topKneeAngle, ...S.lockoutRamp),
    control: ramp(r.durationMs, ...S.controlRamp),
  }
}

/** Rules the server re-applies to every submitted rep (see pushups/scoring.ts). */
export function revalidateSquat(r: SquatRep): SquatRep {
  const reason = !r.valid
    ? r.invalidReason
    : r.minKneeAngle > SQUAT_DETECTOR.validDepthAngle
      ? 'Not deep enough'
      : r.durationMs < SQUAT_DETECTOR.minRepDurationMs
        ? 'Too fast to track reliably'
        : r.confidence < 0.25
          ? 'Low tracking confidence'
          : r.meanTorsoLean > SQUAT_DETECTOR.maxValidTorsoLean
            ? 'Bent over instead of squatting'
            : null
  return { ...r, valid: reason === null, invalidReason: reason }
}

export function scoreSquatRep(r: SquatRep): ScoredSquatRep {
  const components = scoreSquatComponents(r)
  return { ...r, components, formScore: weightedForm(components, S.componentWeights) }
}

export function scoreSquatSession(reps: ScoredSquatRep[], targetReps: number = S.defaultTargetReps): RepSessionScore {
  return scoreRepSession(reps, targetReps, {
    finalFormWeight: S.finalFormWeight,
    finalVolumeWeight: S.finalRepWeight,
    consistencyWeight: S.consistencyWeight,
    consistencyPenaltyPerStdev: S.consistencyPenaltyPerStdev,
    componentWeights: S.componentWeights,
  })
}

export function explainSquats(s: RepSessionScore, reps: ScoredSquatRep[]): string[] {
  const valid = reps.filter((r) => r.valid)
  if (valid.length === 0) return ['No complete squats were detected, so there is no form score yet.']
  const avg = (f: (r: ScoredSquatRep) => number) => Math.round(mean(valid.map(f)))
  const c = s.componentAverages
  const parallel = valid.filter((r) => r.reachedParallel).length
  const lines: { score: number; text: string }[] = [
    {
      score: c.depth,
      text:
        c.depth >= 80
          ? `Good depth — knees averaged ${avg((r) => r.minKneeAngle)}° at the bottom, hips at knee height on ${parallel} of ${valid.length} reps.`
          : `Depth cost points — knees averaged ${avg((r) => r.minKneeAngle)}° at the bottom. Sit back until your hips reach knee height.`,
    },
    {
      score: c.torso,
      text:
        c.torso >= 80
          ? `Chest stayed up — about ${avg((r) => r.maxTorsoLean)}° of forward lean at most.`
          : `You leaned forward up to ${avg((r) => r.maxTorsoLean)}°. Keep your chest up and weight in your heels.`,
    },
    {
      score: c.lockout,
      text: c.lockout >= 80 ? 'You stood all the way up between reps.' : 'Stand fully upright — hips and knees straight — between reps.',
    },
    {
      score: c.control,
      text: c.control >= 80 ? 'Steady, controlled tempo.' : 'Some reps were rushed. Take about two seconds down and up.',
    },
  ]
  if (valid.length >= 2) {
    lines.push({
      score: s.consistency,
      text: s.consistency >= 80 ? 'Your squats were consistent from first to last.' : 'Depth and posture changed a lot between reps.',
    })
  }
  if (valid.some((r) => r.frontView)) {
    lines.push({ score: 50, text: 'Some reps were filmed from the front — turn side-on for more accurate depth readings.' })
  }
  const invalid = reps.length - valid.length
  if (invalid > 0) lines.push({ score: 0, text: `${invalid} rep${invalid === 1 ? '' : 's'} didn't count (shown in the rep list).` })
  return lines.sort((a, b) => a.score - b.score).map((l) => l.text)
}
