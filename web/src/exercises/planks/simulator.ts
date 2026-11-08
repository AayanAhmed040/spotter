/**
 * Test-only plank simulator: side-view forearm (or high) plank, facing left.
 * Supports sag/pike, fatigue drift, hip sway and timed breaks (dropping to the knees).
 */
import { gaussian, mulberry32, offsetForBend } from '../shared/random'
import { LM, type Landmark, type PoseFrame } from '../shared/types'

export const PK_WIDTH = 1280
export const PK_HEIGHT = 720

export interface PlankerProfile {
  /** Body-line bend in degrees: positive = hips sag, negative = hips piked. */
  deviation: number
  /** Extra sag per second (fatigue). */
  fatigueDegPerSec?: number
  /** Hip sway amplitude, degrees of bend. */
  swayDeg?: number
  support?: 'forearm' | 'high'
  noisePx: number
  visibility: number
  /** [startMs, endMs] intervals spent kneeling (not a valid plank). */
  breaks?: [number, number][]
  /** Standing up instead of planking. */
  standing?: boolean
}

const FLOOR = 600
const ANKLE = { x: 1080, y: FLOOR - 10 }

export function plankLandmarks(p: PlankerProfile, tMs: number, rand: () => number): Landmark[] {
  const kneeling = p.breaks?.some(([a, b]) => tMs >= a && tMs < b) ?? false
  const high = p.support === 'high'
  const upper = 120
  const elbow = high ? { x: 380, y: FLOOR - upper - 4 } : { x: 380, y: FLOOR - 4 }
  const shoulder = high ? { x: 380, y: FLOOR - 2 * upper } : { x: 380, y: FLOOR - upper }
  const wrist = high ? { x: 380, y: FLOOR } : { x: 270, y: FLOOR - 2 }

  let hip: { x: number; y: number }
  let knee: { x: number; y: number }
  let ankle = ANKLE
  if (kneeling) {
    hip = { x: 620, y: FLOOR - 80 }
    knee = { x: 760, y: FLOOR - 4 }
    ankle = { x: 960, y: FLOOR - 70 }
  } else {
    const dev =
      p.deviation + (p.fatigueDegPerSec ?? 0) * (tMs / 1000) + (p.swayDeg ?? 0) * Math.sin((tMs / 1000) * 2 * Math.PI * 0.6)
    const dx = ankle.x - shoulder.x
    const dy = ankle.y - shoulder.y
    const len = Math.hypot(dx, dy)
    const ux = dx / len
    const uy = dy / len
    let nx = -uy
    let ny = ux
    if (ny < 0) {
      nx = -nx
      ny = -ny
    }
    const a = 0.47 * len
    const off = offsetForBend(Math.abs(dev), a, len - a) * Math.sign(dev)
    hip = { x: shoulder.x + ux * a + nx * off, y: shoulder.y + uy * a + ny * off }
    knee = { x: hip.x + (ankle.x - hip.x) * 0.52, y: hip.y + (ankle.y - hip.y) * 0.52 }
  }
  const head = { x: shoulder.x - 50, y: shoulder.y - 10 }

  let pts: Record<number, { x: number; y: number }> = {
    [LM.nose]: head,
    [LM.leftShoulder]: shoulder,
    [LM.leftElbow]: elbow,
    [LM.leftWrist]: wrist,
    [LM.leftHip]: hip,
    [LM.leftKnee]: knee,
    [LM.leftAnkle]: ankle,
  }
  if (p.standing) {
    // Rotate the whole body upright around the ankle.
    const rot: typeof pts = {}
    for (const [k, v] of Object.entries(pts)) rot[Number(k)] = { x: ANKLE.x - (ANKLE.y - v.y) * 0.1, y: ANKLE.y - (ANKLE.x - v.x) * 0.8 }
    pts = rot
  }
  for (const [l, r] of [
    [LM.leftShoulder, LM.rightShoulder],
    [LM.leftElbow, LM.rightElbow],
    [LM.leftWrist, LM.rightWrist],
    [LM.leftHip, LM.rightHip],
    [LM.leftKnee, LM.rightKnee],
    [LM.leftAnkle, LM.rightAnkle],
  ]) {
    pts[r] = { x: pts[l].x + 4, y: pts[l].y - 3 }
  }

  const out: Landmark[] = []
  for (let i = 0; i < 33; i++) {
    const q = pts[i] ?? head
    const isRight = i >= 11 && i % 2 === 0
    out.push({
      x: (q.x + gaussian(rand) * p.noisePx) / PK_WIDTH,
      y: (q.y + gaussian(rand) * p.noisePx) / PK_HEIGHT,
      z: 0,
      visibility: pts[i] ? (isRight ? p.visibility * 0.6 : p.visibility) : 0.3,
    })
  }
  return out
}

export function simulatePlank(p: PlankerProfile, durationMs: number, fps = 30, seed = 3): PoseFrame[] {
  const rand = mulberry32(seed)
  const frames: PoseFrame[] = []
  for (let t = 0; t <= durationMs; t += 1000 / fps) {
    frames.push({ landmarks: plankLandmarks(p, t, rand), timestampMs: t, width: PK_WIDTH, height: PK_HEIGHT })
  }
  return frames
}
