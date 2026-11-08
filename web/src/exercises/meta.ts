/**
 * Names and measurement kind for each exercise — tiny, so feed cards and
 * leaderboards can label workouts without loading any detection code.
 */
import type { ExerciseId, MetricKind } from './shared/types'

export interface ExerciseMeta {
  id: ExerciseId
  kind: MetricKind
  /** "Push-ups" */
  name: string
  /** "push-up" / "push-ups" */
  singular: string
  plural: string
  /** One line on what the camera measures. */
  measures: string
}

export const EXERCISE_META: Record<ExerciseId, ExerciseMeta> = {
  pushup: { id: 'pushup', kind: 'reps', name: 'Push-ups', singular: 'push-up', plural: 'push-ups', measures: 'Counts full reps and checks depth and body line.' },
  squat: { id: 'squat', kind: 'reps', name: 'Squats', singular: 'squat', plural: 'squats', measures: 'Counts full reps and checks depth and posture.' },
  plank: { id: 'plank', kind: 'hold', name: 'Plank', singular: 'plank', plural: 'planks', measures: 'Times your hold and checks your body line.' },
}

export const EXERCISE_IDS: ExerciseId[] = ['pushup', 'squat', 'plank']

export function exerciseMeta(id: string | null | undefined): ExerciseMeta {
  return EXERCISE_META[(id as ExerciseId) ?? 'pushup'] ?? EXERCISE_META.pushup
}
