/** Push-up-specific measurement types. */
import type { LiveFeedback, RepBase } from '../shared/types'

export type { Landmark, LiveFeedback, PoseFrame } from '../shared/types'
export { LM } from '../shared/types'

export type HipFault = 'sag' | 'pike' | null

/** Raw, per-rep push-up measurements. These are what the backend stores and re-scores. */
export interface RepMeasurement extends RepBase {
  /** Smallest (deepest) elbow angle reached during the rep, degrees. */
  minElbowAngle: number
  /** Largest elbow angle in the top position before this rep, degrees. */
  topElbowAngle: number
  /** Mean deviation of shoulder–hip–ankle from a straight line, degrees. */
  meanBodyDeviation: number
  maxBodyDeviation: number
  hipFault: HipFault
  /** True when knees were used instead of ankles (ankles out of frame). */
  usedKneesForAlignment: boolean
}

export interface FormComponents {
  depth: number
  lockout: number
  alignment: number
  control: number
  [key: string]: number
}

export interface ScoredRep extends RepMeasurement {
  components: FormComponents
  formScore: number
}

export type DetectorPhase = 'searching' | 'setup' | 'top' | 'down'

export interface FrameAnalysis {
  side: 'left' | 'right'
  elbowAngle: number
  /** 0 = perfectly straight shoulder–hip–ankle line. */
  bodyDeviation: number
  /** Signed: >0 hips below the line (sag), <0 above (pike). Fraction of body length. */
  hipOffset: number
  /** Angle of the shoulder→ankle line from horizontal, degrees. */
  bodyTilt: number
  visibility: number
  wristsBelowShoulders: boolean
  usedKnees: boolean
}

export interface DetectorSnapshot {
  phase: DetectorPhase
  validReps: number
  attemptedReps: number
  elbowAngle: number | null
  feedback: LiveFeedback
  /** Rolling tracking quality 0–1. */
  trackingQuality: number
  lastRep: ScoredRep | null
}
