import { EXERCISE_META } from '../meta'
import type { ExerciseDefinition, HoldSessionScore } from '../definition'
import type { Recording } from '../shared/types'
import { PLANK_SCORING } from './config'
import { PlankTracker } from './detector'
import { explainPlank, scorePlank, windowForm } from './scoring'
import { PLANK_DETECTOR } from './config'

const windows = (r: Recording) => (r.kind === 'hold' ? r.windows : [])

export const planks: ExerciseDefinition = {
  ...EXERCISE_META.plank,
  scoringVersion: PLANK_SCORING.version,
  targets: [30, 60, 90],
  defaultTarget: PLANK_SCORING.defaultTargetSec,
  camera: {
    summary: 'Phone on the floor about 2 m away, landscape, side-on to you.',
    tips: [
      { icon: 'side', title: 'Side-on to the camera', body: 'Your shoulder–hip–ankle line is measured from the side.' },
      { icon: 'floor', title: 'Camera at floor level', body: 'Prop the phone on the floor, about 2 m away, in landscape.' },
      { icon: 'feet', title: 'Head to heels in frame', body: 'The timer only runs while your feet are visible.' },
      { icon: 'privacy', title: 'Video stays on this device', body: 'Only the measurements are saved — never the footage.' },
    ],
  },
  setupVideo: '/media/setup-plank.mp4',
  startCue: 'The timer starts once you hold a straight plank — forearms or hands.',
  components: [
    { key: 'alignment', label: 'Body line', weight: PLANK_SCORING.componentWeights.alignment },
    { key: 'stability', label: 'Stillness', weight: PLANK_SCORING.componentWeights.stability },
    { key: 'stack', label: 'Shoulders stacked', weight: PLANK_SCORING.componentWeights.stack },
  ],
  createTracker: () => new PlankTracker(),
  score: (rec, targetSec) => scorePlank(windows(rec), targetSec * 1000),
  explain: (summary, rec) => explainPlank(summary as HoldSessionScore, windows(rec)),
  details: (rec) => {
    const all = windows(rec)
    const segments = [...new Set(all.map((w) => w.segment))]
    return segments.map((seg, i) => {
      const ws = all.filter((w) => w.segment === seg)
      const ok = ws.filter((w) => w.confidence >= PLANK_SCORING.minWindowConfidence && w.meanBodyDeviation <= PLANK_DETECTOR.maxValidDeviation)
      const ms = ok.reduce((s, w) => s + w.durationMs, 0)
      const lost = ws.reduce((s, w) => s + w.durationMs, 0) - ms
      const form = ms ? ok.reduce((s, w) => s + windowForm(w) * w.durationMs, 0) / ms : 0
      const secs = Math.round(ms / 1000)
      return {
        key: String(seg),
        title: `Hold ${i + 1}`,
        counted: ms > 0,
        value: `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`,
        note: ms
          ? `Form ${Math.round(form)}${lost > 1000 ? `, ${Math.round(lost / 1000)} s not counted (unclear view)` : ''}`
          : "Didn't count — the camera couldn't see you clearly",
      }
    })
  },
}
