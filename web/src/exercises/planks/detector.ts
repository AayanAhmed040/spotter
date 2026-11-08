/**
 * Plank hold tracker — times a held position instead of counting reps.
 *
 *   searching ──(body visible)──▶ setup ──(valid plank for enterMs)──▶ holding
 *   holding ──(invalid frame)──▶ breaking ──(back within graceMs)──▶ holding
 *                                         └─(still invalid after graceMs)──▶ setup (timer paused)
 *
 * Only frames in a valid plank add time; frames during a wobble never count,
 * the grace period only decides whether the hold is "continuous". Frame gaps
 * are capped so a hidden tab can't add time. Measurements are summarised in
 * ≤5 s windows, which the server re-scores.
 */
import { distance, jointAngle, mean, signedOffsetTowardFloor, stdev, tiltFromHorizontal } from '../shared/geometry'
import { joint, pickSide, sideVisibility, stabilityPoints, vis, SIDES } from '../shared/landmarks'
import { FeedbackChannel, round1, StabilityTracker } from '../shared/signal'
import type { ExerciseTracker, HoldWindow, LiveState, PoseFrame, Recording } from '../shared/types'
import { PLANK_DETECTOR as D } from './config'
import { scorePlank, windowForm } from './scoring'

export interface PlankFrame {
  side: 'left' | 'right'
  bodyDeviation: number
  /** >0 hips below the shoulder–ankle line (sag), <0 above (pike). Fraction of body length. */
  hipOffset: number
  bodyTilt: number
  legAngle: number
  support: 'forearm' | 'high'
  /** Shoulder offset from the elbow (forearm plank) or wrist (high plank), fraction of arm length. */
  stackOffset: number
  supportBelowShoulders: boolean
  ankleVisible: boolean
  visibility: number
}

export function analyzePlankFrame(frame: PoseFrame): PlankFrame | null {
  const lm = frame.landmarks
  if (!lm || lm.length < 29) return null
  const side = pickSide(lm, ['shoulder', 'elbow', 'hip', 'ankle'])
  const shoulder = joint(lm, frame, side, 'shoulder')
  const elbow = joint(lm, frame, side, 'elbow')
  const wrist = joint(lm, frame, side, 'wrist')
  const hip = joint(lm, frame, side, 'hip')
  const knee = joint(lm, frame, side, 'knee')
  const ankle = joint(lm, frame, side, 'ankle')

  const elbowAngle = jointAngle(shoulder, elbow, wrist)
  const support = elbowAngle > 140 ? 'high' : 'forearm'
  const base = support === 'high' ? wrist : elbow
  return {
    side,
    bodyDeviation: 180 - jointAngle(shoulder, hip, ankle),
    hipOffset: signedOffsetTowardFloor(hip, shoulder, ankle),
    bodyTilt: tiltFromHorizontal(shoulder, ankle),
    legAngle: jointAngle(hip, knee, ankle),
    support,
    stackOffset: Math.abs(shoulder.x - base.x) / Math.max(1, distance(shoulder, base)),
    supportBelowShoulders: elbow.y > shoulder.y,
    ankleVisible: vis(lm[SIDES[side].ankle]) >= D.minVisibility,
    visibility: sideVisibility(lm, side, ['shoulder', 'elbow', 'hip', 'knee', 'ankle']),
  }
}

/** Why this frame isn't a valid plank, or null if it is. */
export function plankProblem(a: PlankFrame): string | null {
  if (!a.ankleVisible) return 'Move the camera back so your feet are in frame'
  if (a.bodyTilt > D.maxBodyTilt || !a.supportBelowShoulders) return 'Get into a plank, side-on to the camera'
  if (a.legAngle < D.minLegAngle) return 'Straighten your legs — knees off the floor'
  if (a.bodyDeviation > D.maxValidDeviation)
    return a.hipOffset > 0 ? 'Hips dropped too far — lift them into a straight line' : 'Hips too high — lower into a straight line'
  return null
}

interface OpenWindow {
  segment: number
  startMs: number
  durationMs: number
  deviations: number[]
  stacks: number[]
  hipOffsets: number[]
  confidences: number[]
  sag: number
  pike: number
}

type Phase = 'searching' | 'setup' | 'holding' | 'breaking'

export class PlankTracker implements ExerciseTracker {
  private phase: Phase = 'searching'
  private feedback = new FeedbackChannel({ message: 'Step into frame, side-on to the camera', tone: 'neutral' })
  private stability = new StabilityTracker()
  private quality = 0
  private lostCount = 0
  private lastT: number | null = null
  private validSince: number | null = null
  private invalidSince: number | null = null
  private segment = -1
  private open: OpenWindow | null = null
  readonly windows: HoldWindow[] = []

  interrupt(): void {
    this.endSegment()
    this.phase = 'setup'
    this.validSince = null
    this.invalidSince = null
    this.lastT = null
    this.stability.reset()
    this.feedback.force('Get back into your plank to continue', 'neutral')
  }

  recording(): Recording {
    const all = [...this.windows]
    if (this.open && this.open.durationMs >= D.minWindowMs) all.push(this.summarise(this.open))
    return { kind: 'hold', windows: all }
  }

  update(frame: PoseFrame): LiveState {
    const t = frame.timestampMs
    const dt = this.lastT === null ? 0 : Math.min(Math.max(0, t - this.lastT), D.maxFrameGapMs)
    this.lastT = t
    const a = analyzePlankFrame(frame)

    if (!a || a.visibility < D.minVisibility) {
      this.quality *= 0.9
      this.markInvalid(t, a ? 'Hard to see you — improve lighting or move the camera back' : 'Step into frame, side-on to the camera', 'warn')
      if (++this.lostCount > D.lostFramesLimit && this.phase === 'setup') this.phase = 'searching'
      return this.state()
    }
    this.lostCount = 0
    const pts = stabilityPoints(frame)
    const stab = this.stability.update(pts, pts.length > 1 ? distance(pts[0], pts[pts.length - 1]) : 0)
    this.quality = this.quality * 0.85 + 0.15 * a.visibility * stab

    const problem = plankProblem(a)
    if (problem) {
      this.markInvalid(t, problem, this.phase === 'holding' || this.phase === 'breaking' ? 'bad' : 'neutral')
      return this.state()
    }

    // Valid plank frame.
    this.invalidSince = null
    if (this.phase === 'holding' || this.phase === 'breaking') {
      this.phase = 'holding'
      this.accumulate(dt, a, a.visibility * stab)
      this.coach(a, t)
    } else {
      this.phase = 'setup'
      this.validSince ??= t
      if (t - this.validSince >= D.enterMs) {
        this.segment++
        this.phase = 'holding'
        this.feedback.say('Timer running — hold it', 'good', t, 1000)
      } else {
        this.feedback.say('Hold still…', 'neutral', t)
      }
    }
    return this.state()
  }

  private markInvalid(t: number, message: string, tone: 'neutral' | 'warn' | 'bad'): void {
    this.validSince = null
    if (this.phase === 'holding') {
      this.phase = 'breaking'
      this.invalidSince = t
      this.feedback.force(message, tone)
    } else if (this.phase === 'breaking') {
      if (t - (this.invalidSince ?? t) > D.graceMs) {
        this.endSegment()
        this.phase = 'setup'
        this.feedback.force(`${message} — timer paused`, tone)
      } else {
        this.feedback.say(message, tone, t)
      }
    } else {
      if (this.phase === 'searching') this.phase = 'setup'
      this.feedback.say(message, tone, t)
    }
  }

  private accumulate(dt: number, a: PlankFrame, confidence: number): void {
    if (!this.open) {
      const startMs = this.windows.filter((w) => w.segment === this.segment).reduce((s, w) => s + w.durationMs, 0)
      this.open = { segment: this.segment, startMs, durationMs: 0, deviations: [], stacks: [], hipOffsets: [], confidences: [], sag: 0, pike: 0 }
    }
    const w = this.open
    w.durationMs += dt
    w.deviations.push(a.bodyDeviation)
    w.stacks.push(a.stackOffset)
    w.hipOffsets.push(a.hipOffset)
    w.confidences.push(confidence)
    if (a.hipOffset > D.hipFaultThreshold) w.sag++
    else if (a.hipOffset < -D.hipFaultThreshold) w.pike++
    if (w.durationMs >= D.windowMs) {
      this.windows.push(this.summarise(w))
      this.open = null
    }
  }

  private endSegment(): void {
    const w = this.open
    this.open = null
    if (!w || w.durationMs <= 0) return
    if (w.durationMs >= D.minWindowMs) {
      this.windows.push(this.summarise(w))
    } else {
      // Fold a tiny remainder into the previous window of the same hold so no valid time is lost.
      const prev = this.windows[this.windows.length - 1]
      if (prev && prev.segment === w.segment) prev.durationMs = Math.round(prev.durationMs + w.durationMs)
    }
  }

  private summarise(w: OpenWindow): HoldWindow {
    const n = Math.max(1, w.deviations.length)
    return {
      segment: w.segment,
      startMs: Math.round(w.startMs),
      durationMs: Math.round(w.durationMs),
      meanBodyDeviation: round1(mean(w.deviations)),
      meanStackOffset: Math.round(mean(w.stacks) * 1000) / 1000,
      hipSway: Math.round(stdev(w.hipOffsets) * 10000) / 10000,
      sagShare: Math.round((w.sag / n) * 100) / 100,
      pikeShare: Math.round((w.pike / n) * 100) / 100,
      confidence: Math.round(mean(w.confidences) * 100) / 100,
    }
  }

  private coach(a: PlankFrame, t: number): void {
    if (this.feedback.held(t)) return
    if (a.hipOffset > D.hipFaultThreshold * 1.5) this.feedback.say('Hips sagging — squeeze your glutes', 'warn', t, 800)
    else if (a.hipOffset < -D.hipFaultThreshold * 1.5) this.feedback.say('Hips creeping up — lower them a touch', 'warn', t, 800)
    else if (a.stackOffset > D.stackWarning)
      this.feedback.say(`Stack your shoulders over your ${a.support === 'high' ? 'wrists' : 'elbows'}`, 'warn', t, 800)
    else this.feedback.say('Strong line — keep holding', 'good', t)
  }

  private state(): LiveState {
    const closed = this.windows.reduce((s, w) => s + w.durationMs, 0)
    const openMs = this.open?.durationMs ?? 0
    const segMs = (seg: number) => this.windows.filter((w) => w.segment === seg).reduce((s, w) => s + w.durationMs, 0)
    const current = this.phase === 'holding' || this.phase === 'breaking' ? segMs(this.segment) + openMs : 0
    let longest = current
    for (let s = 0; s < this.segment; s++) longest = Math.max(longest, segMs(s))
    const rec = this.recording()
    const live = rec.kind === 'hold' && rec.windows.length ? scorePlank(rec.windows).formScore : null
    const lastWindow = this.open ?? null
    return {
      phase: this.phase === 'searching' ? 'searching' : this.phase === 'setup' ? 'setup' : 'active',
      feedback: this.feedback.get(),
      trackingQuality: Math.round(this.quality * 100) / 100,
      readouts: [
        { label: 'body line', value: lastWindow?.deviations.length ? `${Math.round(lastWindow.deviations[lastWindow.deviations.length - 1])}° off` : '–' },
        { label: 'longest hold', value: formatSeconds(longest) },
      ],
      holding: this.phase === 'holding',
      holdMs: Math.round(closed + openMs),
      currentHoldMs: Math.round(current),
      longestHoldMs: Math.round(longest),
      liveFormScore: live,
    }
  }
}

function formatSeconds(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export { windowForm }
