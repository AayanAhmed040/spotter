import { EXERCISE_META } from '../meta'
import type { ExerciseDefinition } from '../definition'
import type { ExerciseTracker, LiveState, PoseFrame, Recording } from '../shared/types'
import { PushupDetector } from './detector'
import { explainSession, revalidate, SCORING, SCORING_VERSION, scoreRep, scoreSession, type SessionScore } from './scoring'
import type { RepMeasurement } from './types'

/** Adapts the push-up detector to the shared tracker contract. */
class PushupTracker implements ExerciseTracker {
  private d = new PushupDetector()

  update(frame: PoseFrame): LiveState {
    const s = this.d.update(frame)
    return {
      phase: s.phase === 'searching' ? 'searching' : s.phase === 'setup' ? 'setup' : 'active',
      feedback: s.feedback,
      trackingQuality: s.trackingQuality,
      readouts: [{ label: 'elbow angle', value: s.elbowAngle === null ? '–' : `${s.elbowAngle}°` }],
      validReps: s.validReps,
      attemptedReps: s.attemptedReps,
      lastRep: s.lastRep && {
        index: s.lastRep.index,
        valid: s.lastRep.valid,
        formScore: s.lastRep.formScore,
        invalidReason: s.lastRep.invalidReason,
      },
    }
  }

  interrupt(): void {
    this.d.interrupt()
  }

  recording(): Recording {
    // Raw measurements only — the server re-scores them.
    return { kind: 'reps', reps: this.d.reps.map(({ components: _c, formScore: _f, ...m }) => ({ ...m })) }
  }
}

const reps = (r: Recording) => (r.kind === 'reps' ? (r.reps as unknown as RepMeasurement[]).map(revalidate) : [])

export const pushups: ExerciseDefinition = {
  ...EXERCISE_META.pushup,
  scoringVersion: SCORING_VERSION,
  targets: [10, 20, 30],
  defaultTarget: SCORING.defaultTargetReps,
  camera: {
    summary: 'Phone on the floor about 2 m away, landscape, side-on to you.',
    tips: [
      { icon: 'side', title: 'Side-on to the camera', body: 'Elbow and hip angles are measured from the side.' },
      { icon: 'frame', title: 'Head to heels in frame', body: 'Prop your phone on the floor about 2 m away, in landscape.' },
      { icon: 'light', title: 'Light in front of you', body: 'A bright window behind you turns you into a silhouette.' },
      { icon: 'privacy', title: 'Video stays on this device', body: 'Only the measurements are saved — never the footage.' },
    ],
  },
  setupVideo: '/media/pushups-demo.mp4',
  startCue: 'Counting starts once you hold a high plank side-on.',
  components: [
    { key: 'depth', label: 'Depth', weight: SCORING.componentWeights.depth },
    { key: 'alignment', label: 'Body line', weight: SCORING.componentWeights.alignment },
    { key: 'lockout', label: 'Lockout', weight: SCORING.componentWeights.lockout },
    { key: 'control', label: 'Control', weight: SCORING.componentWeights.control },
  ],
  createTracker: () => new PushupTracker(),
  score: (rec, target) => scoreSession(reps(rec).map(scoreRep), target),
  explain: (summary, rec) => explainSession(summary as SessionScore, reps(rec).map(scoreRep)),
  details: (rec) =>
    reps(rec)
      .map(scoreRep)
      .map((r) => ({
        key: String(r.index),
        title: `Rep ${r.index}`,
        counted: r.valid,
        value: r.valid ? `Form ${Math.round(r.formScore)}` : "Didn't count",
        note: r.valid
          ? `Elbows ${Math.round(r.minElbowAngle)}°, body ${Math.round(r.meanBodyDeviation)}° off straight${r.confidence < 0.6 ? ' (low confidence)' : ''}`
          : (r.invalidReason ?? 'Invalid'),
      })),
}
