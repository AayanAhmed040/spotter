/**
 * Plank scoring (mirrored in api/app/scoring/plank.py).
 *
 *   F = (1 − c)·time-and-confidence-weighted window form + c·consistency
 *   T = 100 × min(valid hold ÷ target, 1)
 *   S = 0.7F + 0.3T
 *
 * Only time in a valid plank counts, and T is capped at the target, so neither
 * a sloppy hold nor an endless one is rewarded.
 */
import type { HoldSessionScore } from '../definition'
import { clamp, stdev } from '../shared/geometry'
import { ramp, weightedForm } from '../shared/repScoring'
import { round1 } from '../shared/signal'
import type { HoldWindow } from '../shared/types'
import { PLANK_DETECTOR, PLANK_SCORING as P } from './config'

export function windowComponents(w: HoldWindow): Record<string, number> {
  return {
    alignment: ramp(w.meanBodyDeviation, ...P.alignmentRamp),
    stability: ramp(w.hipSway, ...P.stabilityRamp),
    stack: ramp(w.meanStackOffset, ...P.stackRamp),
  }
}

export function windowForm(w: HoldWindow): number {
  return weightedForm(windowComponents(w), P.componentWeights)
}

export function scorePlank(windows: HoldWindow[], targetHoldMs = P.defaultTargetSec * 1000): HoldSessionScore {
  // Server rules: blurry windows and collapsed body lines never count as hold time.
  const counted = windows.filter(
    (w) => w.confidence >= P.minWindowConfidence && w.meanBodyDeviation <= PLANK_DETECTOR.maxValidDeviation && w.durationMs > 0,
  )
  const discardedMs = windows.reduce((s, w) => s + w.durationMs, 0) - counted.reduce((s, w) => s + w.durationMs, 0)
  const target = Math.max(1000, targetHoldMs)
  const holdMs = counted.reduce((s, w) => s + w.durationMs, 0)

  const bySegment = new Map<number, number>()
  for (const w of counted) bySegment.set(w.segment, (bySegment.get(w.segment) ?? 0) + w.durationMs)
  const longestHoldMs = Math.max(0, ...bySegment.values())

  const componentAverages: Record<string, number> = { alignment: 0, stability: 0, stack: 0 }
  let meanWindowForm = 0
  let consistency = 100
  let formScore = 0
  let confidence = 0

  if (counted.length > 0) {
    const forms = counted.map(windowForm)
    const weights = counted.map((w) => w.durationMs * Math.max(0.05, w.confidence))
    const wSum = weights.reduce((s, w) => s + w, 0)
    meanWindowForm = forms.reduce((s, f, i) => s + f * weights[i], 0) / wSum
    confidence = counted.reduce((s, w) => s + w.confidence * w.durationMs, 0) / holdMs
    if (counted.length >= 2) {
      consistency = clamp(100 - P.consistencyPenaltyPerStdev * stdev(forms), 0, 100)
      formScore = (1 - P.consistencyWeight) * meanWindowForm + P.consistencyWeight * consistency
    } else {
      formScore = meanWindowForm
    }
    for (const key of Object.keys(componentAverages)) {
      componentAverages[key] = round1(counted.reduce((s, w) => s + windowComponents(w)[key] * w.durationMs, 0) / holdMs)
    }
  }

  const holdScore = 100 * Math.min(holdMs / target, 1)
  const finalScore = P.finalFormWeight * formScore + P.finalHoldWeight * holdScore
  return {
    kind: 'hold',
    holdMs: Math.round(holdMs),
    longestHoldMs: Math.round(longestHoldMs),
    targetHoldMs: target,
    meanWindowForm: round1(meanWindowForm),
    consistency: round1(consistency),
    formScore: round1(formScore),
    holdScore: round1(holdScore),
    finalScore: round1(finalScore),
    confidence: Math.round(confidence * 100) / 100,
    componentAverages,
    discardedMs: Math.round(discardedMs),
  }
}

export function explainPlank(s: HoldSessionScore, windows: HoldWindow[]): string[] {
  if (s.holdMs === 0) return ['No valid plank time was recorded, so there is no form score yet.']
  const secs = (ms: number) => `${Math.round(ms / 1000)} s`
  const c = s.componentAverages
  const sag = windows.reduce((a, w) => a + w.sagShare * w.durationMs, 0) / Math.max(1, s.holdMs)
  const pike = windows.reduce((a, w) => a + w.pikeShare * w.durationMs, 0) / Math.max(1, s.holdMs)
  const segments = new Set(windows.map((w) => w.segment)).size
  const lines: { score: number; text: string }[] = [
    {
      score: c.alignment,
      text:
        c.alignment >= 80
          ? 'Shoulders, hips and ankles stayed in a straight line.'
          : sag >= pike
            ? `Hips sagged for about ${Math.round(sag * 100)}% of the hold. Squeeze your glutes and brace your core.`
            : `Hips were piked up for about ${Math.round(pike * 100)}% of the hold. Lower them in line with your shoulders.`,
    },
    {
      score: c.stability,
      text: c.stability >= 80 ? 'Steady — very little hip sway.' : 'Your hips swayed during the hold. Breathe steadily and stay braced.',
    },
    {
      score: c.stack,
      text: c.stack >= 80 ? 'Shoulders stacked over your support.' : 'Move your shoulders directly over your elbows (or wrists).',
    },
    {
      score: segments > 1 ? 40 : 100,
      text:
        segments > 1
          ? `The hold broke ${segments - 1} time${segments > 2 ? 's' : ''}; your longest unbroken hold was ${secs(s.longestHoldMs)}.`
          : `One unbroken hold of ${secs(s.longestHoldMs)}.`,
    },
  ]
  if (s.discardedMs > 1000) {
    lines.push({ score: 0, text: `${secs(s.discardedMs)} didn't count because the camera couldn't see you clearly.` })
  }
  return lines.sort((a, b) => a.score - b.score).map((l) => l.text)
}
