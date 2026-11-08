import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../shared/random'
import type { PoseFrame } from '../shared/types'
import { analyzeSquatFrame, SquatDetector } from './detector'
import { scoreSquatSession } from './scoring'
import { simulateSquats, SQ_HEIGHT, SQ_WIDTH, SQUATTERS, squatLandmarks } from './simulator'

function run(frames: PoseFrame[]) {
  const d = new SquatDetector()
  let state = d.update(frames[0])
  for (const f of frames.slice(1)) state = d.update(f)
  return { d, state }
}

const frame = (kneeAngle: number, lean: number, extra: { frontView?: boolean; visibility?: number } = {}): PoseFrame => ({
  landmarks: squatLandmarks(kneeAngle, lean, { noisePx: 0, visibility: extra.visibility ?? 0.95, frontView: extra.frontView }, mulberry32(1)),
  timestampMs: 0,
  width: SQ_WIDTH,
  height: SQ_HEIGHT,
})

describe('analyzeSquatFrame', () => {
  it('recovers knee angle and torso lean from side-view landmarks', () => {
    for (const [knee, lean] of [
      [175, 3],
      [130, 20],
      [60, 40],
    ]) {
      const a = analyzeSquatFrame(frame(knee, lean))!
      expect(a.kneeAngle).toBeCloseTo(knee, 0)
      expect(a.torsoLean).toBeCloseTo(lean, 0)
      expect(a.frontView).toBe(false)
    }
  })

  it('knows when hips reach knee height', () => {
    expect(analyzeSquatFrame(frame(170, 3))!.hipBelowKnee).toBe(false)
    expect(analyzeSquatFrame(frame(115, 25))!.hipBelowKnee).toBe(false)
    expect(analyzeSquatFrame(frame(56, 38))!.hipBelowKnee).toBe(true)
  })

  it('detects a front-facing camera', () => {
    expect(analyzeSquatFrame(frame(175, 3, { frontView: true }))!.frontView).toBe(true)
  })
})

describe('SquatDetector', () => {
  it('counts each clean squat exactly once', () => {
    const { frames, truthReps } = simulateSquats(SQUATTERS.solid, 30_000)
    const { d } = run(frames)
    expect(truthReps).toBeGreaterThanOrEqual(10)
    expect(d.reps.length).toBe(truthReps)
    expect(d.reps.every((r) => r.valid && r.reachedParallel)).toBe(true)
  })

  it('rejects half squats as not deep enough', () => {
    const { frames, truthReps } = simulateSquats(SQUATTERS.half, 25_000)
    const { d } = run(frames)
    const invalid = d.reps.filter((r) => !r.valid)
    expect(d.reps.length).toBe(truthReps)
    expect(invalid.length).toBe(Math.floor(truthReps / 3))
    expect(invalid.every((r) => r.invalidReason === 'Not deep enough')).toBe(true)
  })

  it('counts nothing when every squat is too shallow', () => {
    const { frames } = simulateSquats(SQUATTERS.shallow, 15_000)
    const { d } = run(frames)
    expect(d.reps.length).toBeGreaterThan(0)
    expect(d.reps.filter((r) => r.valid).length).toBe(0)
  })

  it('scores a forward-leaning torso lower than an upright one', () => {
    const solid = scoreSquatSession(run(simulateSquats(SQUATTERS.solid, 20_000).frames).d.reps)
    const lean = scoreSquatSession(run(simulateSquats(SQUATTERS.leaning, 20_000).frames).d.reps)
    expect(solid.formScore).toBeGreaterThan(85)
    expect(lean.componentAverages.torso).toBeLessThan(solid.componentAverages.torso - 40)
    expect(lean.formScore).toBeLessThan(solid.formScore - 10)
  })

  it('does not start counting when facing the camera, and says why', () => {
    const { frames } = simulateSquats({ ...SQUATTERS.solid, frontView: true }, 12_000)
    const { d, state } = run(frames)
    expect(d.reps.length).toBe(0)
    expect(state.feedback.message).toMatch(/side-on/i)
  })

  it('ignores low-visibility frames instead of guessing', () => {
    const { frames } = simulateSquats({ ...SQUATTERS.solid, visibility: 0.3 }, 12_000)
    const { d, state } = run(frames)
    expect(d.reps.length).toBe(0)
    expect(state.feedback.tone).toBe('warn')
  })

  it('does not double count bobbing at the bottom', () => {
    const d = new SquatDetector()
    const rand = mulberry32(5)
    let t = 0
    const push = (knee: number, lean = 25) =>
      d.update({
        landmarks: squatLandmarks(knee, lean, { noisePx: 0, visibility: 0.95 }, rand),
        timestampMs: (t += 33),
        width: SQ_WIDTH,
        height: SQ_HEIGHT,
      })
    for (let i = 0; i < 12; i++) push(175, 3)
    for (let k = 175; k >= 60; k -= 5) push(k)
    for (let b = 0; b < 4; b++) {
      for (let k = 60; k <= 140; k += 5) push(k)
      for (let k = 140; k >= 60; k -= 5) push(k)
    }
    for (let k = 60; k <= 175; k += 5) push(k, 3)
    for (let i = 0; i < 10; i++) push(175, 3)
    expect(d.reps.length).toBe(1)
    expect(d.reps[0].valid).toBe(true)
  })

  it('keeps reps but requires standing tall again after a pause', () => {
    const { frames } = simulateSquats(SQUATTERS.solid, 12_000)
    const d = new SquatDetector()
    frames.forEach((f) => d.update(f))
    const before = d.reps.length
    d.interrupt()
    expect(d.recording().kind).toBe('reps')
    expect(d.reps.length).toBe(before)
    expect(d.update(frames[frames.length - 1]).phase).toBe('setup')
  })
})
