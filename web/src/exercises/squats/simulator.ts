/**
 * Test-only squat simulator: side-view landmarks for a person facing +x.
 *
 * Ankle is planted. For knee angle θ the shin tilts forward, the thigh hinges
 * back by θ from the shin, and the torso leans forward by β, so the measured
 * knee angle and torso lean are known ground truth.
 */
import { gaussian, mulberry32 } from '../shared/random'
import { LM, type Landmark, type PoseFrame } from '../shared/types'

export const SQ_WIDTH = 1280
export const SQ_HEIGHT = 720

export interface SquatterProfile {
  id: string
  depthAngle: number
  topAngle: number
  /** Torso lean from vertical at the bottom, degrees. */
  leanAtBottom: number
  repMs: number
  pauseMs: number
  /** Every Nth rep only reaches 130° (0 = never). */
  halfRepEvery: number
  noisePx: number
  visibility: number
  /** Facing the camera instead of side-on. */
  frontView?: boolean
}

export const SQUATTERS: Record<string, SquatterProfile> = {
  solid: { id: 'solid', depthAngle: 58, topAngle: 174, leanAtBottom: 30, repMs: 2200, pauseMs: 400, halfRepEvery: 0, noisePx: 1.5, visibility: 0.93 },
  leaning: { id: 'leaning', depthAngle: 62, topAngle: 172, leanAtBottom: 58, repMs: 2000, pauseMs: 300, halfRepEvery: 0, noisePx: 2, visibility: 0.9 },
  half: { id: 'half', depthAngle: 60, topAngle: 172, leanAtBottom: 32, repMs: 1800, pauseMs: 300, halfRepEvery: 3, noisePx: 2, visibility: 0.9 },
  shallow: { id: 'shallow', depthAngle: 120, topAngle: 172, leanAtBottom: 20, repMs: 1500, pauseMs: 300, halfRepEvery: 0, noisePx: 2, visibility: 0.9 },
}

const ANKLE = { x: 640, y: 650 }
const SHIN = 150
const THIGH = 150
const TORSO = 190

/** Landmarks for a given knee angle and torso lean (degrees). */
export function squatLandmarks(
  kneeAngle: number,
  leanDeg: number,
  opts: { noisePx: number; visibility: number; frontView?: boolean },
  rand: () => number,
): Landmark[] {
  const rad = Math.PI / 180
  const depth = Math.max(0, (180 - kneeAngle) / 100)
  const shinTilt = 32 * depth * rad // knee travels forward as you sit
  const knee = { x: ANKLE.x + SHIN * Math.sin(shinTilt), y: ANKLE.y - SHIN * Math.cos(shinTilt) }
  // Unit vector knee→ankle, rotated by the knee angle to get knee→hip; pick the solution behind the knee.
  const ux = (ANKLE.x - knee.x) / SHIN
  const uy = (ANKLE.y - knee.y) / SHIN
  const th = kneeAngle * rad
  const rot = (a: number) => ({ x: ux * Math.cos(a) - uy * Math.sin(a), y: ux * Math.sin(a) + uy * Math.cos(a) })
  const c1 = rot(th)
  const c2 = rot(-th)
  const dir = c1.x <= c2.x ? c1 : c2
  const hip = { x: knee.x + THIGH * dir.x, y: knee.y + THIGH * dir.y }
  const lean = leanDeg * rad
  const shoulder = { x: hip.x + TORSO * Math.sin(lean), y: hip.y - TORSO * Math.cos(lean) }
  const nose = { x: shoulder.x + 14 + 40 * Math.sin(lean), y: shoulder.y - 44 * Math.cos(lean) }
  const elbow = { x: shoulder.x + 70, y: shoulder.y + 18 }
  const wrist = { x: shoulder.x + 140, y: shoulder.y + 8 }
  const heel = { x: ANKLE.x - 18, y: ANKLE.y + 8 }
  const toe = { x: ANKLE.x + 40, y: ANKLE.y + 10 }

  // Far side: nearly hidden behind the near side when side-on; spread apart when facing the camera.
  const spread = opts.frontView ? 130 : 6
  const far = (p: { x: number; y: number }) => ({ x: p.x + spread, y: p.y - 3 })
  const near: Record<number, { x: number; y: number }> = {
    [LM.nose]: nose,
    [LM.leftShoulder]: shoulder,
    [LM.leftElbow]: elbow,
    [LM.leftWrist]: wrist,
    [LM.leftHip]: hip,
    [LM.leftKnee]: knee,
    [LM.leftAnkle]: ANKLE,
    [LM.leftHeel]: heel,
    [LM.leftFootIndex]: toe,
  }
  const pts: Record<number, { x: number; y: number }> = { ...near }
  for (const [l, r] of [
    [LM.leftShoulder, LM.rightShoulder],
    [LM.leftElbow, LM.rightElbow],
    [LM.leftWrist, LM.rightWrist],
    [LM.leftHip, LM.rightHip],
    [LM.leftKnee, LM.rightKnee],
    [LM.leftAnkle, LM.rightAnkle],
    [LM.leftHeel, LM.rightHeel],
    [LM.leftFootIndex, LM.rightFootIndex],
  ]) {
    pts[r] = far(near[l])
  }

  const out: Landmark[] = []
  for (let i = 0; i < 33; i++) {
    const p = pts[i] ?? nose
    const isRight = i >= 11 && i % 2 === 0
    out.push({
      x: (p.x + gaussian(rand) * opts.noisePx) / SQ_WIDTH,
      y: (p.y + gaussian(rand) * opts.noisePx) / SQ_HEIGHT,
      z: 0,
      visibility: pts[i] ? (isRight && !opts.frontView ? opts.visibility * 0.6 : opts.visibility) : 0.3,
    })
  }
  return out
}

export function simulateSquats(profile: SquatterProfile, durationMs: number, fps = 30, seed = 11) {
  const rand = mulberry32(seed)
  const frames: PoseFrame[] = []
  const setupMs = 900
  const cycle = profile.repMs + profile.pauseMs
  let truthReps = 0
  for (let t = 0; t <= durationMs; t += 1000 / fps) {
    let knee = profile.topAngle
    let lean = 4
    if (t > setupMs) {
      const i = Math.floor((t - setupMs) / cycle)
      truthReps = i
      const inCycle = t - setupMs - i * cycle
      if (inCycle < profile.repMs) {
        const half = profile.halfRepEvery > 0 && (i + 1) % profile.halfRepEvery === 0
        const bottom = half ? 130 : profile.depthAngle
        const d = (1 - Math.cos((inCycle / profile.repMs) * 2 * Math.PI)) / 2
        knee = profile.topAngle - (profile.topAngle - bottom) * d
        lean = 4 + (profile.leanAtBottom - 4) * d * ((profile.topAngle - bottom) / (profile.topAngle - profile.depthAngle))
      }
    }
    frames.push({
      landmarks: squatLandmarks(knee, lean, profile, rand),
      timestampMs: t,
      width: SQ_WIDTH,
      height: SQ_HEIGHT,
    })
  }
  return { frames, truthReps }
}
