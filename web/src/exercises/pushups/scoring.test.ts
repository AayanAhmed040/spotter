import { describe, expect, it } from 'vitest'
import { ramp, scoreRep, scoreSession, SCORING } from './scoring'
import type { RepMeasurement } from './types'

function rep(overrides: Partial<RepMeasurement> = {}): RepMeasurement {
  return {
    index: 1,
    valid: true,
    invalidReason: null,
    startMs: 0,
    durationMs: 1200,
    minElbowAngle: 85,
    topElbowAngle: 168,
    meanBodyDeviation: 5,
    maxBodyDeviation: 8,
    hipFault: null,
    confidence: 0.9,
    usedKneesForAlignment: false,
    ...overrides,
  }
}

describe('ramp', () => {
  it('scores 100 at best, 0 at worst, linear between, both directions', () => {
    expect(ramp(85, 85, 115)).toBe(100)
    expect(ramp(115, 85, 115)).toBe(0)
    expect(ramp(100, 85, 115)).toBeCloseTo(50)
    expect(ramp(170, 165, 150)).toBe(100)
    expect(ramp(140, 165, 150)).toBe(0)
  })
})

describe('final score formula', () => {
  // The worked example from the brief: S = 0.7F + 0.3R, T = 20.
  it('User A: 20 reps at form 70 → 79', () => {
    const S = SCORING.finalFormWeight * 70 + SCORING.finalRepWeight * 100 * Math.min(20 / 20, 1)
    expect(S).toBeCloseTo(79)
  })
  it('User B: 15 reps at form 95 → 89 (beats A)', () => {
    const S = SCORING.finalFormWeight * 95 + SCORING.finalRepWeight * 100 * Math.min(15 / 20, 1)
    expect(S).toBeCloseTo(89)
  })
})

describe('scoreSession', () => {
  it('perfect reps at target score 100', () => {
    const reps = Array.from({ length: 20 }, (_, i) => scoreRep(rep({ index: i + 1 })))
    const s = scoreSession(reps, 20)
    expect(s.formScore).toBe(100)
    expect(s.repScore).toBe(100)
    expect(s.finalScore).toBe(100)
  })

  it('invalid reps do not count toward N or F', () => {
    const reps = [
      scoreRep(rep({ index: 1 })),
      scoreRep(rep({ index: 2, valid: false, invalidReason: 'Not deep enough', minElbowAngle: 125 })),
    ]
    const s = scoreSession(reps, 20)
    expect(s.validReps).toBe(1)
    expect(s.attemptedReps).toBe(2)
    expect(s.formScore).toBe(100)
  })

  it('one great rep cannot carry many poor reps', () => {
    const poor = Array.from({ length: 9 }, (_, i) =>
      scoreRep(rep({ index: i + 2, minElbowAngle: 104, meanBodyDeviation: 28 })),
    )
    const reps = [scoreRep(rep({ index: 1 })), ...poor]
    const s = scoreSession(reps, 20)
    // A "best rep" model would give ~100; ours stays close to the poor reps' level.
    expect(s.formScore).toBeLessThan(poor[0].formScore + 10)
  })

  it('quality beats quantity: 15 clean reps outscore 30 sloppy reps', () => {
    const clean = Array.from({ length: 15 }, (_, i) => scoreRep(rep({ index: i + 1 })))
    const sloppy = Array.from({ length: 30 }, (_, i) =>
      scoreRep(rep({ index: i + 1, minElbowAngle: 103, meanBodyDeviation: 25, durationMs: 500 })),
    )
    expect(scoreSession(clean, 20).finalScore).toBeGreaterThan(scoreSession(sloppy, 20).finalScore)
  })

  it('low-confidence reps carry less weight', () => {
    const good = scoreRep(rep({ confidence: 0.95 }))
    const badButUncertain = scoreRep(rep({ minElbowAngle: 110, confidence: 0.1 }))
    const s = scoreSession([good, badButUncertain], 20)
    expect(s.meanRepForm).toBeGreaterThan((good.formScore + badButUncertain.formScore) / 2)
  })

  it('no valid reps → zero', () => {
    const s = scoreSession([], 20)
    expect(s.finalScore).toBe(0)
  })
})
