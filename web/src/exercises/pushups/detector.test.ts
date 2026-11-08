import { describe, expect, it } from 'vitest'
import { analyzeFrame, PushupDetector } from './detector'
import { ATHLETES, buildLandmarks, mulberry32, simulateSession, SIM_HEIGHT, SIM_WIDTH } from './simulator'
import { scoreSession } from './scoring'
import type { PoseFrame } from './types'

const athlete = (id: string) => ATHLETES.find((a) => a.id === id)!

function run(frames: PoseFrame[]) {
  const d = new PushupDetector()
  let snap = d.update(frames[0])
  for (const f of frames.slice(1)) snap = d.update(f)
  return { d, snap }
}

describe('analyzeFrame geometry', () => {
  it('recovers the simulated elbow angle and body deviation', () => {
    const rand = mulberry32(1)
    for (const [angle, dev] of [
      [170, 0],
      [120, 10],
      [85, -8],
    ]) {
      const lm = buildLandmarks(angle, dev, { noisePx: 0, visibility: 0.95 }, rand)
      const a = analyzeFrame({ landmarks: lm, timestampMs: 0, width: SIM_WIDTH, height: SIM_HEIGHT })!
      expect(a.elbowAngle).toBeCloseTo(angle, 0)
      expect(a.bodyDeviation).toBeCloseTo(Math.abs(dev), 0)
      if (dev === 0) expect(Math.abs(a.hipOffset)).toBeLessThan(0.01)
      else expect(Math.sign(a.hipOffset)).toBe(Math.sign(dev))
      expect(a.side).toBe('left')
    }
  })

  it('uses pixel space, so a non-square image does not distort angles', () => {
    const lm = buildLandmarks(90, 0, { noisePx: 0, visibility: 0.95 }, mulberry32(2))
    const a = analyzeFrame({ landmarks: lm, timestampMs: 0, width: SIM_WIDTH, height: SIM_HEIGHT })!
    const squashed = analyzeFrame({ landmarks: lm, timestampMs: 0, width: SIM_WIDTH, height: SIM_WIDTH })!
    expect(a.elbowAngle).toBeCloseTo(90, 0)
    expect(Math.abs(squashed.elbowAngle - 90)).toBeGreaterThan(5)
  })
})

describe('PushupDetector', () => {
  it('counts every rep exactly once for clean form (with landmark noise)', () => {
    const { frames, truthReps } = simulateSession(athlete('solid'), 20_000)
    const { snap } = run(frames)
    expect(truthReps).toBeGreaterThanOrEqual(10)
    expect(snap.validReps).toBe(truthReps)
    expect(snap.attemptedReps).toBe(truthReps)
  })

  it('separates half reps from full reps', () => {
    const { frames, truthReps } = simulateSession(athlete('half-reps'), 15_000)
    const { d } = run(frames)
    const half = Math.floor(truthReps / 3)
    expect(d.reps.length).toBe(truthReps)
    expect(d.reps.filter((r) => !r.valid).length).toBe(half)
    expect(d.reps.filter((r) => !r.valid).every((r) => r.invalidReason === 'Not deep enough')).toBe(true)
  })

  it('flags sagging hips and scores them lower than clean form', () => {
    const solid = run(simulateSession(athlete('solid'), 15_000).frames).d
    const sag = run(simulateSession(athlete('sagging'), 15_000).frames).d
    expect(sag.reps.filter((r) => r.valid).every((r) => r.hipFault === 'sag')).toBe(true)
    const sSolid = scoreSession(solid.reps)
    const sSag = scoreSession(sag.reps)
    expect(sSolid.formScore).toBeGreaterThan(90)
    expect(sSag.formScore).toBeLessThan(sSolid.formScore - 15)
    expect(sSag.componentAverages.alignment).toBeLessThan(sSolid.componentAverages.alignment)
  })

  it('does not count while standing (not in a plank)', () => {
    const d = new PushupDetector()
    // Rotate the plank 90° so the body is vertical, then "bend the arms" a few times.
    for (let i = 0; i < 300; i++) {
      const angle = 120 + 50 * Math.cos(i / 10)
      const lm = buildLandmarks(angle, 0, { noisePx: 0, visibility: 0.95 }, mulberry32(i)).map((l) => ({
        ...l,
        x: 0.5 + (l.y - 0.5) * (SIM_HEIGHT / SIM_WIDTH),
        y: 0.5 - (l.x - 0.5) * (SIM_WIDTH / SIM_HEIGHT) * 0.5,
      }))
      d.update({ landmarks: lm, timestampMs: i * 33, width: SIM_WIDTH, height: SIM_HEIGHT })
    }
    expect(d.reps.length).toBe(0)
  })

  it('ignores frames with low landmark visibility instead of guessing', () => {
    const { frames } = simulateSession({ ...athlete('solid'), visibility: 0.3 }, 10_000)
    const { snap } = run(frames)
    expect(snap.attemptedReps).toBe(0)
    expect(snap.feedback.tone).toBe('warn')
  })

  it('does not double count jitter around the bottom', () => {
    const d = new PushupDetector()
    const rand = mulberry32(7)
    let t = 0
    const push = (angle: number) => {
      d.update({
        landmarks: buildLandmarks(angle, 0, { noisePx: 0, visibility: 0.95 }, rand),
        timestampMs: (t += 33),
        width: SIM_WIDTH,
        height: SIM_HEIGHT,
      })
    }
    for (let i = 0; i < 15; i++) push(170) // get ready
    for (let a = 170; a >= 85; a -= 5) push(a)
    // Bounce between 85° and 135° several times without reaching the top.
    for (let k = 0; k < 4; k++) {
      for (let a = 85; a <= 135; a += 5) push(a)
      for (let a = 135; a >= 85; a -= 5) push(a)
    }
    for (let a = 85; a <= 170; a += 5) push(a)
    for (let i = 0; i < 10; i++) push(170)
    expect(d.reps.length).toBe(1)
    expect(d.reps[0].valid).toBe(true)
  })
})
