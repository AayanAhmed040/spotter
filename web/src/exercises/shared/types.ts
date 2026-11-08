/**
 * Types shared by every exercise. Exercise-specific measurements live in
 * each exercise's own folder (pushups/, squats/, planks/).
 */

/** A single pose landmark. x/y are normalized to [0,1] of the image, like MediaPipe. */
export interface Landmark {
  x: number
  y: number
  z?: number
  visibility?: number
}

/** One frame of pose data handed to a tracker. */
export interface PoseFrame {
  /** 33 MediaPipe BlazePose landmarks, or empty if no person was found. */
  landmarks: Landmark[]
  /** Milliseconds, monotonically increasing. */
  timestampMs: number
  /** Image size in pixels — needed so angles aren't distorted by the aspect ratio. */
  width: number
  height: number
}

/** MediaPipe BlazePose landmark indices. */
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
  leftHeel: 29,
  rightHeel: 30,
  leftFootIndex: 31,
  rightFootIndex: 32,
} as const

export type FeedbackTone = 'neutral' | 'good' | 'warn' | 'bad'

export interface LiveFeedback {
  message: string
  tone: FeedbackTone
}

export type ExerciseId = 'pushup' | 'squat' | 'plank'

/** Rep exercises count repetitions; hold exercises time a position. */
export type MetricKind = 'reps' | 'hold'

/** Fields every repetition measurement has, whatever the exercise. */
export interface RepBase {
  index: number
  valid: boolean
  invalidReason: string | null
  startMs: number
  durationMs: number
  /** 0–1: landmark visibility × stability during the rep. */
  confidence: number
}

/** A rep after scoring. `components` are 0–100 sub-scores, named per exercise. */
export type Scored<R extends RepBase> = R & { components: Record<string, number>; formScore: number }

/**
 * One slice (≤ 5 s) of a held position. Hold exercises record windows instead of
 * reps so the server can re-score the hold from raw measurements.
 */
export interface HoldWindow {
  /** Which continuous hold this window belongs to (0, 1, 2…). */
  segment: number
  startMs: number
  durationMs: number
  /** Mean shoulder–hip–ankle deviation from a straight line, degrees. */
  meanBodyDeviation: number
  /** How far the shoulders sit from over the elbows/wrists, as a fraction of arm length. */
  meanStackOffset: number
  /** Standard deviation of the hip's position, as a fraction of body length (sway). */
  hipSway: number
  /** Share of frames with hips sagging / piked (0–1). */
  sagShare: number
  pikeShare: number
  confidence: number
}

/** Everything a finished set produced, before scoring. Sent to the API as-is. */
export type Recording =
  | { kind: 'reps'; reps: (RepBase & Record<string, unknown>)[] }
  | { kind: 'hold'; windows: HoldWindow[] }

/** What the live workout screen shows. Rep- and hold-specific fields are optional. */
export interface LiveState {
  /** searching: no body · setup: body seen, not in start position · active: tracking. */
  phase: 'searching' | 'setup' | 'active'
  feedback: LiveFeedback
  /** Rolling tracking quality 0–1. */
  trackingQuality: number
  /** Small exercise-specific readouts (e.g. "knee angle"). */
  readouts: { label: string; value: string }[]
  // Rep exercises
  validReps?: number
  attemptedReps?: number
  lastRep?: { index: number; valid: boolean; formScore: number; invalidReason: string | null } | null
  // Hold exercises
  holding?: boolean
  holdMs?: number
  currentHoldMs?: number
  longestHoldMs?: number
  /** Live form estimate for the hold so far (0–100), or null before any valid time. */
  liveFormScore?: number | null
}

/** A live tracker for one exercise. Fed one pose frame at a time. */
export interface ExerciseTracker {
  update(frame: PoseFrame): LiveState
  /** After a pause: keep what was recorded, but require the start position again. */
  interrupt(): void
  recording(): Recording
}
