/**
 * Squat repetition detector.
 *
 * Measured from the side: the knee angle (hip–knee–ankle) drives the state
 * machine, the torso angle from vertical measures posture.
 *
 *   searching ──(body visible)──▶ setup ──(standing tall, side-on, N frames)──▶ top
 *   top ──(knee < descentStart, armed)──▶ down
 *   down ──(knee ≥ standAngle)──▶ top   ← the rep closes here, exactly once
 *
 * "armed" is only set while standing tall, so bobbing at the bottom can't
 * count twice.
 */
import { distance, jointAngle, mean } from '../shared/geometry'
import { joint, pickSide, sideVisibility, stabilityPoints, vis } from '../shared/landmarks'
import { Ema, FeedbackChannel, round1, StabilityTracker } from '../shared/signal'
import { LM, type ExerciseTracker, type LiveState, type PoseFrame, type Recording } from '../shared/types'
import { SQUAT_DETECTOR as D } from './config'
import { scoreSquatRep } from './scoring'
import type { ScoredSquatRep, SquatFrame, SquatRep } from './types'

type Phase = 'searching' | 'setup' | 'top' | 'down'

interface RepInProgress {
  startMs: number
  minKnee: number
  leans: number[]
  visibilities: number[]
  stabilities: number[]
  reachedParallel: boolean
  frontView: boolean
  shallowHintShown: boolean
}

export function analyzeSquatFrame(frame: PoseFrame): SquatFrame | null {
  const lm = frame.landmarks
  if (!lm || lm.length < 29) return null
  const side = pickSide(lm, ['shoulder', 'hip', 'knee', 'ankle'])
  const shoulder = joint(lm, frame, side, 'shoulder')
  const hip = joint(lm, frame, side, 'hip')
  const knee = joint(lm, frame, side, 'knee')
  const ankle = joint(lm, frame, side, 'ankle')

  const torsoLen = Math.max(1, distance(shoulder, hip))
  const span = Math.abs(lm[LM.leftShoulder].x - lm[LM.rightShoulder].x) * frame.width
  const torsoLean = (Math.atan2(Math.abs(shoulder.x - hip.x), hip.y - shoulder.y) * 180) / Math.PI

  return {
    side,
    kneeAngle: jointAngle(hip, knee, ankle),
    torsoLean,
    // Hip crease at (or a touch above) knee height counts as parallel.
    hipBelowKnee: hip.y >= knee.y - 0.12 * torsoLen,
    visibility: sideVisibility(lm, side, ['shoulder', 'hip', 'knee', 'ankle']),
    ankleVisible: vis(lm[side === 'left' ? LM.leftAnkle : LM.rightAnkle]) >= D.minVisibility,
    upright: shoulder.y < hip.y && hip.y < knee.y && knee.y < ankle.y,
    frontView: span / torsoLen > D.frontViewRatio,
  }
}

export class SquatDetector implements ExerciseTracker {
  private phase: Phase = 'searching'
  private knee = new Ema(D.smoothing)
  private stability = new StabilityTracker()
  private feedback = new FeedbackChannel({ message: 'Step into frame, side-on to the camera', tone: 'neutral' })
  private readyCount = 0
  private lostCount = 0
  private armed = false
  private topMax = 0
  private rep: RepInProgress | null = null
  private quality = 0
  private lastLean = 0
  private lastRep: ScoredSquatRep | null = null
  readonly reps: ScoredSquatRep[] = []

  interrupt(): void {
    this.rep = null
    this.phase = 'setup'
    this.readyCount = 0
    this.armed = false
    this.knee.reset()
    this.stability.reset()
    this.feedback.force('Stand tall, side-on, to continue', 'neutral')
  }

  recording(): Recording {
    return { kind: 'reps', reps: this.reps.map(({ components: _c, formScore: _f, ...r }) => ({ ...r })) }
  }

  update(frame: PoseFrame): LiveState {
    const t = frame.timestampMs
    const a = analyzeSquatFrame(frame)

    if (!a || a.visibility < D.minVisibility) {
      this.quality *= 0.9
      if (++this.lostCount > D.lostFramesLimit) {
        this.rep = null
        this.phase = 'searching'
        this.readyCount = 0
        this.armed = false
        this.knee.reset()
        this.stability.reset()
      }
      this.feedback.say(
        a ? 'Hard to see your legs — improve lighting or move the camera back' : 'Step into frame, side-on to the camera',
        'warn',
        t,
      )
      return this.state()
    }
    this.lostCount = 0
    const pts = stabilityPoints(frame)
    const stab = this.stability.update(pts, pts.length > 1 ? distance(pts[0], pts[pts.length - 1]) : 0)
    this.quality = this.quality * 0.85 + 0.15 * a.visibility * stab
    const knee = this.knee.push(a.kneeAngle)
    this.lastLean = a.torsoLean

    switch (this.phase) {
      case 'searching':
      case 'setup': {
        this.phase = 'setup'
        const standing = a.upright && knee >= D.standAngle - 5 && a.torsoLean <= D.standingMaxLean
        if (a.frontView) {
          this.readyCount = 0
          this.feedback.say('Turn side-on to the camera', 'neutral', t)
        } else if (!a.ankleVisible) {
          this.readyCount = 0
          this.feedback.say('Step back so your feet are in frame', 'neutral', t)
        } else if (!standing) {
          this.readyCount = 0
          this.feedback.say('Stand tall to start', 'neutral', t)
        } else if (++this.readyCount >= D.readyFrames) {
          this.phase = 'top'
          this.armed = true
          this.topMax = knee
          this.feedback.say('Ready — start squatting', 'good', t, 1200)
        } else {
          this.feedback.say('Hold still…', 'neutral', t)
        }
        break
      }

      case 'top': {
        if (knee >= D.standAngle) {
          this.armed = true
          this.topMax = Math.max(this.topMax, knee)
        }
        if (this.armed && knee < D.descentStartAngle) {
          this.phase = 'down'
          this.armed = false
          this.rep = {
            startMs: t,
            minKnee: knee,
            leans: [],
            visibilities: [],
            stabilities: [],
            reachedParallel: false,
            frontView: false,
            shallowHintShown: false,
          }
        } else if (!this.feedback.held(t)) {
          this.feedback.say(a.frontView ? 'Turn side-on for accurate depth' : 'Sit back and down', 'neutral', t)
        }
        break
      }

      case 'down': {
        const rep = this.rep!
        rep.minKnee = Math.min(rep.minKnee, knee)
        rep.leans.push(a.torsoLean)
        rep.visibilities.push(a.visibility)
        rep.stabilities.push(stab)
        rep.reachedParallel ||= a.hipBelowKnee
        rep.frontView ||= a.frontView

        if (a.torsoLean > D.leanWarning) this.feedback.say('Chest up — keep your back straighter', 'warn', t)
        if (!rep.shallowHintShown && rep.minKnee > D.validDepthAngle && knee > rep.minKnee + 12) {
          rep.shallowHintShown = true
          this.feedback.say('Go lower — hips toward knee height', 'warn', t, 1200)
        }

        if (knee >= D.standAngle) {
          this.closeRep(t)
          this.phase = 'top'
          this.armed = true
          this.topMax = knee
        } else if (t - rep.startMs > D.maxRepDurationMs) {
          this.rep = null
          this.phase = 'top' // must stand tall (re-arm) before another rep can start
          this.feedback.say('Rep timed out — stand up to reset', 'warn', t)
        }
        break
      }
    }
    return this.state()
  }

  private closeRep(t: number): void {
    const rep = this.rep!
    this.rep = null
    const durationMs = t - rep.startMs
    const maxLean = Math.max(0, ...rep.leans)
    const visibility = mean(rep.visibilities)
    const confidence = Math.round(Math.min(1, visibility * mean(rep.stabilities)) * 100) / 100

    let invalidReason: string | null = null
    if (rep.minKnee > D.validDepthAngle) invalidReason = 'Not deep enough'
    else if (durationMs < D.minRepDurationMs) invalidReason = 'Too fast to track reliably'
    else if (visibility < D.minVisibility) invalidReason = 'Low tracking confidence'
    else if (mean(rep.leans) > D.maxValidTorsoLean) invalidReason = 'Bent over instead of squatting'

    const m: SquatRep = {
      index: this.reps.length + 1,
      valid: invalidReason === null,
      invalidReason,
      startMs: Math.round(rep.startMs),
      durationMs: Math.round(durationMs),
      minKneeAngle: round1(rep.minKnee),
      topKneeAngle: round1(this.topMax),
      maxTorsoLean: round1(maxLean),
      meanTorsoLean: round1(mean(rep.leans)),
      reachedParallel: rep.reachedParallel,
      frontView: rep.frontView,
      confidence,
    }
    const scored = scoreSquatRep(m)
    this.reps.push(scored)
    this.lastRep = scored

    if (!scored.valid) this.feedback.say(`Didn't count: ${invalidReason!.toLowerCase()}`, 'bad', t, 1400)
    else if (scored.formScore >= 85) this.feedback.say('Great squat!', 'good', t, 900)
    else if (scored.components.depth < 60) this.feedback.say('Counted — sit a little deeper', 'warn', t, 1100)
    else if (scored.components.torso < 60) this.feedback.say('Counted — keep your chest up', 'warn', t, 1100)
    else this.feedback.say('Good squat', 'good', t, 900)
  }

  private state(): LiveState {
    const knee = this.knee.get()
    return {
      phase: this.phase === 'searching' ? 'searching' : this.phase === 'setup' ? 'setup' : 'active',
      feedback: this.feedback.get(),
      trackingQuality: Math.round(this.quality * 100) / 100,
      readouts: [
        { label: 'knee angle', value: knee === null ? '–' : `${Math.round(knee)}°` },
        { label: 'torso lean', value: knee === null ? '–' : `${Math.round(this.lastLean)}°` },
      ],
      validReps: this.reps.filter((r) => r.valid).length,
      attemptedReps: this.reps.length,
      lastRep: this.lastRep && {
        index: this.lastRep.index,
        valid: this.lastRep.valid,
        formScore: this.lastRep.formScore,
        invalidReason: this.lastRep.invalidReason,
      },
    }
  }
}
