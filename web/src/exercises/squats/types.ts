import type { RepBase } from '../shared/types'

/** Raw, per-rep squat measurements. Stored by the API and re-scored there. */
export interface SquatRep extends RepBase {
  /** Deepest knee angle (hip–knee–ankle), degrees. */
  minKneeAngle: number
  /** Knee angle while standing before this rep, degrees. */
  topKneeAngle: number
  /** Torso angle from vertical, degrees. */
  maxTorsoLean: number
  meanTorsoLean: number
  /** Hips reached knee height (parallel) at some point in the rep. */
  reachedParallel: boolean
  /** User was facing the camera rather than side-on — angles are less reliable. */
  frontView: boolean
}

export interface SquatComponents {
  depth: number
  torso: number
  lockout: number
  control: number
  [key: string]: number
}

export interface ScoredSquatRep extends SquatRep {
  components: SquatComponents
  formScore: number
}

export interface SquatFrame {
  side: 'left' | 'right'
  kneeAngle: number
  /** Hip→shoulder line from vertical, degrees (0 = upright). */
  torsoLean: number
  hipBelowKnee: boolean
  visibility: number
  ankleVisible: boolean
  /** Shoulders, hips, knees and ankles stacked top-to-bottom in the image. */
  upright: boolean
  frontView: boolean
}
