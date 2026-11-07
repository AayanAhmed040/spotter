/** A single pose landmark. x/y are normalized to [0,1] of the image, like MediaPipe. */
export interface Landmark {
  x: number
  y: number
  z?: number
  visibility?: number
}

/** One frame of pose data handed to the detector. */
export interface PoseFrame {
  /** 33 MediaPipe BlazePose landmarks, or empty if no person was found. */
  landmarks: Landmark[]
  /** Milliseconds, monotonically increasing. */
  timestampMs: number
  /** Image size in pixels — needed so angles aren't distorted by the aspect ratio. */
  width: number
  height: number
}

/** MediaPipe BlazePose landmark indices used by the push-up detector. */
export const LM = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
} as const

export type HipFault = 'sag' | 'pike' | null

/** Raw, per-rep measurements. These are what the backend stores and re-scores. */
export interface RepMeasurement {
  index: number
  valid: boolean
  invalidReason: string | null
  startMs: number
  durationMs: number
  /** Smallest (deepest) elbow angle reached during the rep, degrees. */
  minElbowAngle: number
  /** Largest elbow angle in the top position before this rep, degrees. */
  topElbowAngle: number
  /** Mean deviation of shoulder–hip–ankle from a straight line, degrees. */
  meanBodyDeviation: number
  maxBodyDeviation: number
  hipFault: HipFault
  /** 0–1: landmark visibility × stability during the rep. */
  confidence: number
  /** True when knees were used instead of ankles (ankles out of frame). */
  usedKneesForAlignment: boolean
}

export interface FormComponents {
  depth: number
  lockout: number
  alignment: number
  control: number
}

export interface ScoredRep extends RepMeasurement {
  components: FormComponents
  formScore: number
}

export type DetectorPhase = 'searching' | 'setup' | 'top' | 'down'

export type FeedbackTone = 'neutral' | 'good' | 'warn' | 'bad'

export interface LiveFeedback {
  message: string
  tone: FeedbackTone
}

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
