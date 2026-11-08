import { EXERCISE_META } from '../meta'
import type { ExerciseDefinition } from '../definition'
import type { RepSessionScore } from '../shared/repScoring'
import type { Recording } from '../shared/types'
import { SQUAT_SCORING } from './config'
import { SquatDetector } from './detector'
import { explainSquats, revalidateSquat, scoreSquatRep, scoreSquatSession } from './scoring'
import type { SquatRep } from './types'

const reps = (r: Recording) => (r.kind === 'reps' ? (r.reps as unknown as SquatRep[]).map(revalidateSquat) : [])

export const squats: ExerciseDefinition = {
  ...EXERCISE_META.squat,
  scoringVersion: SQUAT_SCORING.version,
  targets: [10, 20, 30],
  defaultTarget: SQUAT_SCORING.defaultTargetReps,
  camera: {
    summary: 'Phone at hip height about 2.5 m away, side-on to you.',
    tips: [
      { icon: 'side', title: 'Stand side-on', body: 'Knee and hip angles are only reliable from the side. A slight angle is fine.' },
      { icon: 'feet', title: 'Head to feet in frame', body: 'Prop the phone at about hip height, 2–3 m away, so your feet stay visible at the bottom.' },
      { icon: 'light', title: 'Light in front of you', body: 'Avoid standing in front of a bright window.' },
      { icon: 'privacy', title: 'Video stays on this device', body: 'Only the measurements are saved — never the footage.' },
    ],
  },
  setupVideo: '/media/setup-squats.mp4',
  startCue: 'Counting starts once you stand tall, side-on.',
  components: [
    { key: 'depth', label: 'Depth', weight: SQUAT_SCORING.componentWeights.depth },
    { key: 'torso', label: 'Chest up', weight: SQUAT_SCORING.componentWeights.torso },
    { key: 'lockout', label: 'Stand tall', weight: SQUAT_SCORING.componentWeights.lockout },
    { key: 'control', label: 'Control', weight: SQUAT_SCORING.componentWeights.control },
  ],
  createTracker: () => new SquatDetector(),
  score: (rec, target) => scoreSquatSession(reps(rec).map(scoreSquatRep), target),
  explain: (summary, rec) => explainSquats(summary as RepSessionScore, reps(rec).map(scoreSquatRep)),
  details: (rec) =>
    reps(rec)
      .map(scoreSquatRep)
      .map((r) => ({
        key: String(r.index),
        title: `Rep ${r.index}`,
        counted: r.valid,
        value: r.valid ? `Form ${Math.round(r.formScore)}` : "Didn't count",
        note: r.valid
          ? `Knees ${Math.round(r.minKneeAngle)}°${r.reachedParallel ? ' (parallel)' : ''}, chest lean up to ${Math.round(r.maxTorsoLean)}°${r.confidence < 0.6 ? ' (low confidence)' : ''}`
          : (r.invalidReason ?? 'Invalid'),
      })),
}
