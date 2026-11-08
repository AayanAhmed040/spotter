import { describe, expect, it } from 'vitest'
import type { LiveState, PoseFrame } from '../shared/types'
import { analyzePlankFrame, PlankTracker } from './detector'
import { scorePlank } from './scoring'
import { PK_HEIGHT, PK_WIDTH, plankLandmarks, simulatePlank, type PlankerProfile } from './simulator'
import { mulberry32 } from '../shared/random'

const solid: PlankerProfile = { deviation: 3, swayDeg: 0.5, noisePx: 1.5, visibility: 0.93 }

function run(frames: PoseFrame[]) {
  const t = new PlankTracker()
  const states: LiveState[] = []
  for (const f of frames) states.push(t.update(f))
  const rec = t.recording()
  if (rec.kind !== 'hold') throw new Error('expected hold recording')
  return { t, states, windows: rec.windows, last: states[states.length - 1] }
}

const near = (ms: number, target: number, tol = 300) => Math.abs(ms - target) <= tol

describe('analyzePlankFrame', () => {
  it('measures body line, sag/pike direction and support type', () => {
    const rand = mulberry32(1)
    const f = (p: PlankerProfile): PoseFrame => ({ landmarks: plankLandmarks(p, 0, rand), timestampMs: 0, width: PK_WIDTH, height: PK_HEIGHT })
    const straight = analyzePlankFrame(f({ deviation: 0, noisePx: 0, visibility: 0.95 }))!
    expect(straight.bodyDeviation).toBeLessThan(1)
    expect(straight.support).toBe('forearm')
    const sag = analyzePlankFrame(f({ deviation: 15, noisePx: 0, visibility: 0.95 }))!
    expect(sag.bodyDeviation).toBeCloseTo(15, 0)
    expect(sag.hipOffset).toBeGreaterThan(0)
    const pike = analyzePlankFrame(f({ deviation: -15, noisePx: 0, visibility: 0.95 }))!
    expect(pike.hipOffset).toBeLessThan(0)
    expect(analyzePlankFrame(f({ deviation: 0, noisePx: 0, visibility: 0.95, support: 'high' }))!.support).toBe('high')
  })
})

describe('PlankTracker', () => {
  it('times a clean hold, starting once the position is established', () => {
    const { windows, last } = run(simulatePlank(solid, 20_000))
    const s = scorePlank(windows, 60_000)
    // 20 s on camera, minus the 0.6 s needed to confirm the plank.
    expect(near(s.holdMs, 19_400)).toBe(true)
    expect(s.longestHoldMs).toBe(s.holdMs)
    expect(near(last.holdMs!, 19_400)).toBe(true)
    expect(s.formScore).toBeGreaterThan(85)
    // Windows close on the first frame past 5 s, so they can run one frame over.
    expect(windows.every((w) => w.durationMs <= 5000 + 250)).toBe(true)
  })

  it('stops the timer when the user drops to their knees, and resumes as a new hold', () => {
    const profile = { ...solid, breaks: [[10_000, 14_000]] as [number, number][] }
    const { windows, states } = run(simulatePlank(profile, 25_000))
    const s = scorePlank(windows, 60_000)
    // During the break the timer must not move.
    const at = (ms: number) => states[Math.round((ms / 1000) * 30)]
    expect(Math.abs(at(13_500).holdMs! - at(10_500).holdMs!)).toBeLessThan(50)
    expect(at(13_500).holding).toBe(false)
    expect(at(13_500).feedback.message).toMatch(/knees/i)
    // 9.4 s before the break + 10.4 s after it.
    expect(near(s.holdMs, 19_800, 400)).toBe(true)
    expect(near(s.longestHoldMs, 10_400, 400)).toBe(true)
    expect(new Set(windows.map((w) => w.segment)).size).toBe(2)
  })

  it('treats a brief wobble as the same hold without counting the wobble', () => {
    const profile = { ...solid, breaks: [[8_000, 8_400]] as [number, number][] }
    const { windows } = run(simulatePlank(profile, 16_000))
    const s = scorePlank(windows, 60_000)
    expect(new Set(windows.map((w) => w.segment)).size).toBe(1)
    expect(near(s.holdMs, 15_000, 400)).toBe(true)
    expect(s.longestHoldMs).toBe(s.holdMs)
  })

  it('scores sagging hips lower and says so', () => {
    const good = scorePlank(run(simulatePlank(solid, 15_000)).windows)
    const { windows, states } = run(simulatePlank({ ...solid, deviation: 16 }, 15_000))
    const bad = scorePlank(windows)
    expect(bad.componentAverages.alignment).toBeLessThan(good.componentAverages.alignment - 30)
    expect(bad.formScore).toBeLessThan(good.formScore - 15)
    expect(states.some((s) => /sagging/i.test(s.feedback.message))).toBe(true)
  })

  it('does not count time with a badly collapsed body line', () => {
    const { windows, last } = run(simulatePlank({ ...solid, deviation: 35 }, 10_000))
    expect(scorePlank(windows).holdMs).toBe(0)
    expect(last.feedback.message).toMatch(/hips dropped/i)
  })

  it('stops counting once fatigue makes the hips collapse', () => {
    // Sag grows 2°/s: valid until roughly 12.5 s (28° limit).
    const { windows } = run(simulatePlank({ ...solid, fatigueDegPerSec: 2 }, 25_000))
    const s = scorePlank(windows)
    expect(s.holdMs).toBeGreaterThan(9_000)
    expect(s.holdMs).toBeLessThan(13_500)
  })

  it('counts nothing while standing or when barely visible', () => {
    expect(scorePlank(run(simulatePlank({ ...solid, standing: true }, 8_000)).windows).holdMs).toBe(0)
    const dim = run(simulatePlank({ ...solid, visibility: 0.3 }, 8_000))
    expect(scorePlank(dim.windows).holdMs).toBe(0)
    expect(dim.last.feedback.tone).toBe('warn')
  })

  it('caps frame gaps so a stalled camera cannot add time', () => {
    const frames = simulatePlank(solid, 4_000)
    const gap = frames.map((f, i) => (i > 60 ? { ...f, timestampMs: f.timestampMs + 30_000 } : f))
    const s = scorePlank(run(gap).windows)
    expect(s.holdMs).toBeLessThan(4_000)
  })

  it('caps the time score at the target so longer holds are not endlessly better', () => {
    const { windows } = run(simulatePlank(solid, 40_000))
    const s30 = scorePlank(windows, 30_000)
    expect(s30.holdScore).toBe(100)
    expect(s30.finalScore).toBeLessThanOrEqual(100)
  })

  it('discards windows the camera could not see clearly', () => {
    const s = scorePlank([
      { segment: 0, startMs: 0, durationMs: 5000, meanBodyDeviation: 4, meanStackOffset: 0.1, hipSway: 0.004, sagShare: 0, pikeShare: 0, confidence: 0.9 },
      { segment: 0, startMs: 5000, durationMs: 5000, meanBodyDeviation: 4, meanStackOffset: 0.1, hipSway: 0.004, sagShare: 0, pikeShare: 0, confidence: 0.2 },
    ])
    expect(s.holdMs).toBe(5000)
    expect(s.discardedMs).toBe(5000)
  })
})
