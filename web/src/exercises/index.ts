/**
 * Exercise registry. To add an exercise: create a folder with a tracker,
 * scoring and an ExerciseDefinition, then list it here (and add its scorer
 * to api/app/scoring/).
 */
import type { ExerciseDefinition } from './definition'
import { planks } from './planks'
import { pushups } from './pushups'
import type { ExerciseId } from './shared/types'
import { squats } from './squats'

export const EXERCISES: ExerciseDefinition[] = [pushups, squats, planks]

export const EXERCISE_BY_ID: Record<ExerciseId, ExerciseDefinition> = { pushup: pushups, squat: squats, plank: planks }

export function getExercise(id: string | null | undefined): ExerciseDefinition {
  return EXERCISE_BY_ID[(id as ExerciseId) ?? 'pushup'] ?? pushups
}

export type { ExerciseDefinition, HoldSessionScore, SessionSummary } from './definition'
export type { ExerciseId, MetricKind, Recording } from './shared/types'
