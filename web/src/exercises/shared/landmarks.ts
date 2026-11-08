/** Landmark helpers: pixel conversion, visibility, and choosing the side facing the camera. */
import { mean, type Point } from './geometry'
import { LM, type Landmark, type PoseFrame } from './types'

/** Convert a normalized landmark to pixel space so angles aren't skewed by aspect ratio. */
export function px(l: Landmark, frame: Pick<PoseFrame, 'width' | 'height'>): Point {
  return { x: l.x * frame.width, y: l.y * frame.height }
}

export function vis(l: Landmark | undefined): number {
  return l?.visibility ?? 0
}

export const SIDES = {
  left: {
    shoulder: LM.leftShoulder,
    elbow: LM.leftElbow,
    wrist: LM.leftWrist,
    hip: LM.leftHip,
    knee: LM.leftKnee,
    ankle: LM.leftAnkle,
    heel: LM.leftHeel,
  },
  right: {
    shoulder: LM.rightShoulder,
    elbow: LM.rightElbow,
    wrist: LM.rightWrist,
    hip: LM.rightHip,
    knee: LM.rightKnee,
    ankle: LM.rightAnkle,
    heel: LM.rightHeel,
  },
} as const

export type Side = keyof typeof SIDES
export type Joint = keyof (typeof SIDES)['left']

/** The body side whose `joints` are most visible — the one nearest a side-on camera. */
export function pickSide(lm: Landmark[], joints: Joint[]): Side {
  const score = (s: Side) => mean(joints.map((j) => vis(lm[SIDES[s][j]])))
  return score('left') >= score('right') ? 'left' : 'right'
}

/** Mean visibility of the given joints on one side. */
export function sideVisibility(lm: Landmark[], side: Side, joints: Joint[]): number {
  return mean(joints.map((j) => vis(lm[SIDES[side][j]])))
}

/** Pixel position of a joint on one side. */
export function joint(lm: Landmark[], frame: PoseFrame, side: Side, j: Joint): Point {
  return px(lm[SIDES[side][j]], frame)
}

/** Points used for stability (jitter) tracking. */
export function stabilityPoints(frame: PoseFrame): Point[] {
  const ids = [LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip, LM.leftKnee, LM.leftAnkle]
  return ids.filter((i) => frame.landmarks[i]).map((i) => px(frame.landmarks[i], frame))
}
