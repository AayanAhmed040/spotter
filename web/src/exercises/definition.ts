/**
 * The contract every exercise implements. The workout screen, results screen
 * and API payloads are built from this, so adding an exercise means adding a
 * folder with a definition — not editing the UI.
 */
import type { RepSessionScore } from './shared/repScoring'
import type { ExerciseMeta } from './meta'
import type { ExerciseTracker, Recording } from './shared/types'

export type TipIcon = 'side' | 'frame' | 'light' | 'privacy' | 'floor' | 'feet'

export interface HoldSessionScore {
  kind: 'hold'
  /** Total time spent in a valid position, ms. */
  holdMs: number
  /** Longest continuous valid hold, ms. */
  longestHoldMs: number
  targetHoldMs: number
  meanWindowForm: number
  consistency: number
  formScore: number
  /** T — time score, 0–100 (capped at the target, so longer isn't endlessly better). */
  holdScore: number
  finalScore: number
  confidence: number
  componentAverages: Record<string, number>
  /** Windows dropped for low tracking confidence. */
  discardedMs: number
}

export type SessionSummary = RepSessionScore | HoldSessionScore

/** One line in the results breakdown: a rep, or one continuous hold. */
export interface DetailRow {
  key: string
  title: string
  value: string
  note: string
  counted: boolean
}

export interface ExerciseDefinition extends ExerciseMeta {
  scoringVersion: number
  /** Rep targets, or hold targets in seconds. */
  targets: number[]
  defaultTarget: number
  camera: { summary: string; tips: { icon: TipIcon; title: string; body: string }[] }
  /** Drop a clip at web/public/media/<file> to show a setup video before recording. */
  setupVideo: string
  /** Shown while waiting for the start position. */
  startCue: string
  /** Per-rep (or per-window) form components, in display order. */
  components: { key: string; label: string; weight: number }[]
  createTracker(): ExerciseTracker
  score(recording: Recording, target: number): SessionSummary
  explain(summary: SessionSummary, recording: Recording): string[]
  details(recording: Recording): DetailRow[]
}
