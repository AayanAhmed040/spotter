/**
 * Simulated athlete for unit tests: physically plausible side-view push-up
 * landmarks. Test-only — never shown in the app.
 *
 * Geometry: wrist planted under the shoulder, upper arm and forearm of equal
 * length L. For elbow angle θ, the shoulder sits 2L·sin(θ/2) above the wrist
 * and the elbow bulges L·cos(θ/2) toward the feet. Feet are the pivot.
 */
import { gaussian, mulberry32 } from '../shared/random'
import type { Landmark, PoseFrame } from '../shared/types'
import { LM } from '../shared/types'

export interface AthleteProfile {
  id: string
  label: string
  description: string
  /** Deepest elbow angle reached, degrees. */
  depthAngle: number
  /** Arm extension at the top, degrees. */
  topAngle: number
  /** Body-line deviation in degrees (positive = hips sag, negative = pike). */
  hipDeviation: number
  /** Time for one down-and-up, ms. */
  repMs: number
  /** Pause at the top between reps, ms. */
  pauseMs: number
  /** Every Nth rep is a half rep (0 = never). */
  halfRepEvery: number
  /** Gaussian landmark noise, pixels. */
  noisePx: number
  visibility: number
  /** Form gets worse rep by rep (adds this many degrees of sag per rep). */
  fatiguePerRep: number
}

export const ATHLETES: AthleteProfile[] = [
  {
    id: 'solid',
    label: 'Solid form',
    description: 'Full depth, straight body, steady tempo',
    depthAngle: 82,
    topAngle: 170,
    hipDeviation: 3,
    repMs: 1500,
    pauseMs: 350,
    halfRepEvery: 0,
    noisePx: 1.5,
    visibility: 0.95,
    fatiguePerRep: 0,
  },
  {
    id: 'sagging',
    label: 'Sagging hips',
    description: 'Good depth, but the hips drop more as fatigue sets in',
    depthAngle: 88,
    topAngle: 166,
    hipDeviation: 14,
    repMs: 1200,
    pauseMs: 250,
    halfRepEvery: 0,
    noisePx: 2,
    visibility: 0.92,
    fatiguePerRep: 1.2,
  },
  {
    id: 'half-reps',
    label: 'Rushed half reps',
    description: 'Fast reps, and every third one stops short',
    depthAngle: 100,
    topAngle: 160,
    hipDeviation: -6,
    repMs: 700,
    pauseMs: 120,
    halfRepEvery: 3,
    noisePx: 2.5,
    visibility: 0.9,
    fatiguePerRep: 0,
  },
]

export const SIM_WIDTH = 1280
export const SIM_HEIGHT = 720

const FLOOR_Y = 600
const WRIST_X = 380
const ANKLE_X = 1080
const ARM_SEG = 118 // upper arm = forearm length, px
const HIP_FRACTION = 0.47

export { mulberry32 } from '../shared/random'

export interface SimulatedPose {
  /** Elbow angle the simulator intended at this instant (ground truth). */
  elbowAngle: number
  /** Number of reps fully completed by this time (ground truth, includes half reps). */
  repsCompleted: number
  landmarks: Landmark[]
}

/** Ground-truth pose at time t (ms) since the athlete got into position. */
export function poseAt(profile: AthleteProfile, tMs: number, rand: () => number = Math.random): SimulatedPose {
  const setupMs = 900 // hold the plank before the first rep
  const cycle = profile.repMs + profile.pauseMs
  let elbowAngle = profile.topAngle
  let repsCompleted = 0
  let repIndex = 0

  if (tMs > setupMs) {
    const t = tMs - setupMs
    repIndex = Math.floor(t / cycle)
    repsCompleted = repIndex
    const inCycle = t - repIndex * cycle
    if (inCycle < profile.repMs) {
      const isHalf = profile.halfRepEvery > 0 && (repIndex + 1) % profile.halfRepEvery === 0
      const bottom = isHalf ? 128 : profile.depthAngle
      // Smooth down-and-up: cosine from top → bottom → top.
      const phase = inCycle / profile.repMs
      const depth = (1 - Math.cos(phase * 2 * Math.PI)) / 2
      elbowAngle = profile.topAngle - (profile.topAngle - bottom) * depth
    }
  }

  const deviationDeg = profile.hipDeviation + profile.fatiguePerRep * repIndex
  const landmarks = buildLandmarks(elbowAngle, deviationDeg, profile, rand)
  return { elbowAngle, repsCompleted, landmarks }
}

export function buildLandmarks(
  elbowAngleDeg: number,
  hipDeviationDeg: number,
  profile: Pick<AthleteProfile, 'noisePx' | 'visibility'>,
  rand: () => number,
): Landmark[] {
  const theta = (elbowAngleDeg * Math.PI) / 180
  const reach = 2 * ARM_SEG * Math.sin(theta / 2)
  const wrist = { x: WRIST_X, y: FLOOR_Y }
  const shoulder = { x: WRIST_X, y: FLOOR_Y - reach }
  const elbow = { x: WRIST_X + ARM_SEG * Math.cos(theta / 2), y: FLOOR_Y - reach / 2 }
  const ankle = { x: ANKLE_X, y: FLOOR_Y - 12 }

  // Hip: on the shoulder→ankle line, pushed perpendicular to create the requested angle.
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
  const a = HIP_FRACTION * len
  const b = (1 - HIP_FRACTION) * len
  const offset = solveOffset(Math.abs(hipDeviationDeg), a, b) * Math.sign(hipDeviationDeg)
  const hip = { x: shoulder.x + ux * a + nx * offset, y: shoulder.y + uy * a + ny * offset }
  const knee = { x: hip.x + (ankle.x - hip.x) * 0.52, y: hip.y + (ankle.y - hip.y) * 0.52 }
  const head = { x: shoulder.x - 50, y: shoulder.y - 12 }

  const points: Record<number, { x: number; y: number }> = {
    [LM.nose]: head,
    [LM.leftShoulder]: shoulder,
    [LM.rightShoulder]: { x: shoulder.x + 4, y: shoulder.y - 3 },
    [LM.leftElbow]: elbow,
    [LM.rightElbow]: { x: elbow.x + 4, y: elbow.y - 3 },
    [LM.leftWrist]: wrist,
    [LM.rightWrist]: { x: wrist.x + 4, y: wrist.y - 2 },
    [LM.leftHip]: hip,
    [LM.rightHip]: { x: hip.x + 3, y: hip.y - 3 },
    [LM.leftKnee]: knee,
    [LM.rightKnee]: { x: knee.x + 3, y: knee.y - 2 },
    [LM.leftAnkle]: ankle,
    [LM.rightAnkle]: { x: ankle.x + 3, y: ankle.y - 2 },
  }

  const out: Landmark[] = []
  for (let i = 0; i < 33; i++) {
    const p = points[i] ?? head
    const isFar = i % 2 === 0 && i >= 11 // right side is farther from the camera
    out.push({
      x: (p.x + gaussian(rand) * profile.noisePx) / SIM_WIDTH,
      y: (p.y + gaussian(rand) * profile.noisePx) / SIM_HEIGHT,
      z: 0,
      visibility: points[i] ? (isFar ? profile.visibility * 0.6 : profile.visibility) : 0.3,
    })
  }
  return out
}

/** Perpendicular hip offset that bends the shoulder–hip–ankle line by `devDeg`. */
function solveOffset(devDeg: number, a: number, b: number): number {
  if (devDeg <= 0) return 0
  const target = (devDeg * Math.PI) / 180
  let lo = 0
  let hi = Math.min(a, b)
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    const dev = Math.atan(mid / a) + Math.atan(mid / b)
    if (dev < target) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** Generate a full session of frames at a fixed frame rate. */
export function simulateSession(
  profile: AthleteProfile,
  durationMs: number,
  fps = 30,
  seed = 42,
): { frames: PoseFrame[]; truthReps: number } {
  const rand = mulberry32(seed)
  const frames: PoseFrame[] = []
  let truthReps = 0
  for (let t = 0; t <= durationMs; t += 1000 / fps) {
    const pose = poseAt(profile, t, rand)
    truthReps = pose.repsCompleted
    frames.push({ landmarks: pose.landmarks, timestampMs: t, width: SIM_WIDTH, height: SIM_HEIGHT })
  }
  return { frames, truthReps }
}
