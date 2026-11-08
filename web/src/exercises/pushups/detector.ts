/**
 * Push-up repetition detector.
 *
 * Input: pose landmarks per frame (from MediaPipe or the simulator).
 * Output: live phase/feedback plus a list of measured reps.
 *
 * State machine (on the smoothed elbow angle, with hysteresis):
 *
 *   searching ──(body visible)──▶ setup ──(plank held N frames)──▶ top
 *   top ──(elbow < descentStart, and armed)──▶ down
 *   down ──(elbow ≥ topAngle)──▶ top   ← one rep is closed here, exactly once
 *
 * "armed" is only set once the arms are extended, so bouncing around the
 * bottom or hovering mid-range can never produce a second count.
 */
import { clamp, distance, jointAngle, mean, signedOffsetTowardFloor, tiltFromHorizontal, type Point } from '../shared/geometry'
import { scoreRep } from './scoring'
import {
  LM,
  type DetectorPhase,
  type DetectorSnapshot,
  type FrameAnalysis,
  type HipFault,
  type Landmark,
  type LiveFeedback,
  type PoseFrame,
  type RepMeasurement,
  type ScoredRep,
} from './types'

export const DETECTOR = {
  minVisibility: 0.5,
  /** Elbow angle considered "arms extended". */
  topAngle: 155,
  /** Leaving the top: a rep starts below this angle. */
  descentStartAngle: 140,
  /** Elbow must reach this angle or lower for the rep to count. */
  validDepthAngle: 105,
  /** Mean body-line deviation above this means it isn't a push-up rep. */
  maxValidBodyDeviation: 45,
  minRepDurationMs: 350,
  maxRepDurationMs: 10_000,
  /** Shoulder→ankle line must be within this many degrees of horizontal. */
  plankMaxTiltDeg: 40,
  readyFrames: 6,
  /** Exponential smoothing for the elbow angle (0 = none, →1 = heavy). */
  smoothing: 0.4,
  /** Frames without a usable body before we fall back to searching. */
  lostFramesLimit: 20,
  /** Hip offset (fraction of body length) treated as sag / pike. */
  hipFaultThreshold: 0.035,
}

interface RepInProgress {
  startMs: number
  minElbow: number
  deviations: number[]
  hipOffsets: number[]
  visibilities: number[]
  stabilities: number[]
  usedKnees: boolean
  shallowHintShown: boolean
}

export class PushupDetector {
  private phase: DetectorPhase = 'searching'
  private smoothedElbow: number | null = null
  private readyCount = 0
  private lostCount = 0
  private armed = false
  private topMax = 0
  private rep: RepInProgress | null = null
  private prevKeyPoints: Point[] | null = null
  private stability = 1
  private trackingQuality = 0
  private feedback: LiveFeedback = { message: 'Step into frame', tone: 'neutral' }
  private feedbackHoldUntil = 0
  private lastRep: ScoredRep | null = null
  readonly reps: ScoredRep[] = []

  reset(): void {
    this.phase = 'searching'
    this.smoothedElbow = null
    this.readyCount = 0
    this.lostCount = 0
    this.armed = false
    this.topMax = 0
    this.rep = null
    this.prevKeyPoints = null
    this.stability = 1
    this.trackingQuality = 0
    this.feedback = { message: 'Step into frame', tone: 'neutral' }
    this.feedbackHoldUntil = 0
    this.lastRep = null
    this.reps.length = 0
  }

  /** After a pause: keep counted reps, but require a fresh plank before counting again. */
  interrupt(): void {
    this.rep = null
    this.phase = 'setup'
    this.readyCount = 0
    this.armed = false
    this.smoothedElbow = null
    this.prevKeyPoints = null
    this.feedback = { message: 'Get back into your plank', tone: 'neutral' }
    this.feedbackHoldUntil = 0
  }

  /** Feed one frame. Returns the current live state. */
  update(frame: PoseFrame): DetectorSnapshot {
    const a = analyzeFrame(frame)
    const t = frame.timestampMs

    if (!a || a.visibility < DETECTOR.minVisibility) {
      this.trackingQuality = this.trackingQuality * 0.9
      this.lostCount++
      if (this.lostCount > DETECTOR.lostFramesLimit) {
        if (this.rep) this.abandonRep()
        this.phase = 'searching'
        this.readyCount = 0
        this.armed = false
        this.smoothedElbow = null
        this.prevKeyPoints = null
      }
      this.say(
        a ? 'Hard to see you — improve lighting or move the camera back' : 'Step into frame, side-on to the camera',
        'warn',
        t,
      )
      return this.snapshot()
    }
    this.lostCount = 0

    this.updateStability(frame)
    this.trackingQuality = this.trackingQuality * 0.85 + 0.15 * (a.visibility * this.stability)

    const s = DETECTOR.smoothing
    this.smoothedElbow = this.smoothedElbow === null ? a.elbowAngle : s * this.smoothedElbow + (1 - s) * a.elbowAngle
    const elbow = this.smoothedElbow
    const inPlank = a.bodyTilt <= DETECTOR.plankMaxTiltDeg && a.wristsBelowShoulders

    switch (this.phase) {
      case 'searching':
      case 'setup': {
        this.phase = 'setup'
        if (inPlank && elbow >= DETECTOR.topAngle - 5) {
          this.readyCount++
          if (this.readyCount >= DETECTOR.readyFrames) {
            this.phase = 'top'
            this.armed = true
            this.topMax = elbow
            this.say('Ready — start your push-ups', 'good', t, 1200)
          } else {
            this.say('Hold your plank…', 'neutral', t)
          }
        } else {
          this.readyCount = 0
          this.say(
            a.bodyTilt > DETECTOR.plankMaxTiltDeg
              ? 'Get into a high plank, side-on to the camera'
              : 'Straighten your arms to start',
            'neutral',
            t,
          )
        }
        break
      }

      case 'top': {
        if (elbow >= DETECTOR.topAngle) {
          this.armed = true
          this.topMax = Math.max(this.topMax, elbow)
        }
        if (!inPlank && elbow >= DETECTOR.topAngle - 5) {
          // Stood up or knelt — go back to setup without counting anything.
          this.readyCount++
          if (this.readyCount > 30) {
            this.phase = 'setup'
            this.readyCount = 0
            this.armed = false
          }
          break
        }
        this.readyCount = 0
        if (this.armed && elbow < DETECTOR.descentStartAngle) {
          this.phase = 'down'
          this.armed = false
          this.rep = {
            startMs: t,
            minElbow: elbow,
            deviations: [],
            hipOffsets: [],
            visibilities: [],
            stabilities: [],
            usedKnees: false,
            shallowHintShown: false,
          }
        }
        if (this.phase === 'top' && t > this.feedbackHoldUntil && this.feedback.tone !== 'good') {
          this.say('Lower with control', 'neutral', t)
        }
        break
      }

      case 'down': {
        const rep = this.rep!
        rep.minElbow = Math.min(rep.minElbow, elbow)
        rep.deviations.push(a.bodyDeviation)
        rep.hipOffsets.push(a.hipOffset)
        rep.visibilities.push(a.visibility)
        rep.stabilities.push(this.stability)
        rep.usedKnees ||= a.usedKnees

        if (a.hipOffset > DETECTOR.hipFaultThreshold * 1.5) this.say('Hips sagging — brace your core', 'warn', t)
        else if (a.hipOffset < -DETECTOR.hipFaultThreshold * 1.5) this.say('Hips too high — lower them', 'warn', t)

        // Coming back up without having reached depth.
        if (!rep.shallowHintShown && rep.minElbow > DETECTOR.validDepthAngle && elbow > rep.minElbow + 12) {
          rep.shallowHintShown = true
          this.say('Go lower — chest toward the floor', 'warn', t, 1200)
        }

        if (elbow >= DETECTOR.topAngle) {
          this.closeRep(t)
          this.phase = 'top'
          this.armed = true
          this.topMax = elbow
        } else if (t - rep.startMs > DETECTOR.maxRepDurationMs) {
          this.abandonRep()
          this.phase = 'top' // must re-extend (armed=false) before another rep can start
          this.say('Rep timed out — push back up to reset', 'warn', t)
        }
        break
      }
    }

    return this.snapshot()
  }

  private closeRep(t: number): void {
    const rep = this.rep!
    this.rep = null
    const durationMs = t - rep.startMs
    const meanDev = mean(rep.deviations)
    const meanHip = mean(rep.hipOffsets)
    const hipFault: HipFault =
      meanHip > DETECTOR.hipFaultThreshold ? 'sag' : meanHip < -DETECTOR.hipFaultThreshold ? 'pike' : null
    const visibility = mean(rep.visibilities)
    const confidence = clamp(visibility * mean(rep.stabilities), 0, 1)

    let invalidReason: string | null = null
    if (rep.minElbow > DETECTOR.validDepthAngle) invalidReason = 'Not deep enough'
    else if (durationMs < DETECTOR.minRepDurationMs) invalidReason = 'Too fast to track reliably'
    else if (visibility < DETECTOR.minVisibility) invalidReason = 'Low tracking confidence'
    else if (meanDev > DETECTOR.maxValidBodyDeviation) invalidReason = 'Body not in a plank'

    const measurement: RepMeasurement = {
      index: this.reps.length + 1,
      valid: invalidReason === null,
      invalidReason,
      startMs: Math.round(rep.startMs),
      durationMs: Math.round(durationMs),
      minElbowAngle: round1(rep.minElbow),
      topElbowAngle: round1(this.topMax),
      meanBodyDeviation: round1(meanDev),
      maxBodyDeviation: round1(Math.max(0, ...rep.deviations)),
      hipFault,
      confidence: Math.round(confidence * 100) / 100,
      usedKneesForAlignment: rep.usedKnees,
    }
    const scored = scoreRep(measurement)
    this.reps.push(scored)
    this.lastRep = scored

    if (!scored.valid) this.say(`Didn't count: ${invalidReason!.toLowerCase()}`, 'bad', t, 1400)
    else if (scored.formScore >= 85) this.say('Great rep!', 'good', t, 900)
    else if (scored.components.depth < 60) this.say('Counted — go a little deeper', 'warn', t, 1100)
    else if (scored.components.alignment < 60)
      this.say(hipFault === 'pike' ? 'Counted — keep hips down' : 'Counted — keep hips up', 'warn', t, 1100)
    else this.say('Good rep', 'good', t, 900)
  }

  private abandonRep(): void {
    this.rep = null
  }

  private updateStability(frame: PoseFrame): void {
    const pts = keyPoints(frame)
    if (this.prevKeyPoints && pts.length === this.prevKeyPoints.length) {
      const body = Math.max(1, distance(pts[0], pts[pts.length - 1]))
      const prev = this.prevKeyPoints
      // Jitter relative to body size; real movement is slow relative to frame rate,
      // so large frame-to-frame jumps indicate unreliable landmarks.
      const jitter = mean(pts.map((p, i) => distance(p, prev[i]))) / body
      const frameStability = clamp(1 - Math.max(0, jitter - 0.015) * 12, 0, 1)
      this.stability = this.stability * 0.8 + frameStability * 0.2
    }
    this.prevKeyPoints = pts
  }

  private say(message: string, tone: LiveFeedback['tone'], t: number, holdMs = 0): void {
    // Don't overwrite an important message (e.g. "Great rep!") before it has been seen.
    if (t < this.feedbackHoldUntil && holdMs === 0) return
    this.feedback = { message, tone }
    if (holdMs > 0) this.feedbackHoldUntil = t + holdMs
  }

  private snapshot(): DetectorSnapshot {
    return {
      phase: this.phase,
      validReps: this.reps.filter((r) => r.valid).length,
      attemptedReps: this.reps.length,
      elbowAngle: this.smoothedElbow === null ? null : Math.round(this.smoothedElbow),
      feedback: this.feedback,
      trackingQuality: Math.round(this.trackingQuality * 100) / 100,
      lastRep: this.lastRep,
    }
  }
}

/** Convert a normalized landmark to pixel space so angles aren't skewed by aspect ratio. */
function px(l: Landmark, frame: PoseFrame): Point {
  return { x: l.x * frame.width, y: l.y * frame.height }
}

function vis(l: Landmark | undefined): number {
  return l?.visibility ?? 0
}

/** Pick the side of the body facing the camera and measure the push-up geometry. */
export function analyzeFrame(frame: PoseFrame): FrameAnalysis | null {
  const lm = frame.landmarks
  if (!lm || lm.length < 29) return null

  const sides = {
    left: { s: LM.leftShoulder, e: LM.leftElbow, w: LM.leftWrist, h: LM.leftHip, k: LM.leftKnee, a: LM.leftAnkle },
    right: {
      s: LM.rightShoulder,
      e: LM.rightElbow,
      w: LM.rightWrist,
      h: LM.rightHip,
      k: LM.rightKnee,
      a: LM.rightAnkle,
    },
  }
  const sideVis = (k: keyof typeof sides) => {
    const i = sides[k]
    return mean([vis(lm[i.s]), vis(lm[i.e]), vis(lm[i.w]), vis(lm[i.h])])
  }
  const side: 'left' | 'right' = sideVis('left') >= sideVis('right') ? 'left' : 'right'
  const idx = sides[side]

  // Ankles are often cut off on phone cameras; fall back to knees for the body line.
  const ankleVisible = vis(lm[idx.a]) >= DETECTOR.minVisibility
  const footIdx = ankleVisible ? idx.a : idx.k

  const shoulder = px(lm[idx.s], frame)
  const elbow = px(lm[idx.e], frame)
  const wrist = px(lm[idx.w], frame)
  const hip = px(lm[idx.h], frame)
  const foot = px(lm[footIdx], frame)

  const visibility = mean([lm[idx.s], lm[idx.e], lm[idx.w], lm[idx.h], lm[footIdx]].map(vis))

  return {
    side,
    elbowAngle: jointAngle(shoulder, elbow, wrist),
    bodyDeviation: 180 - jointAngle(shoulder, hip, foot),
    hipOffset: signedOffsetTowardFloor(hip, shoulder, foot),
    bodyTilt: tiltFromHorizontal(shoulder, foot),
    visibility,
    wristsBelowShoulders: wrist.y > shoulder.y,
    usedKnees: !ankleVisible,
  }
}

function keyPoints(frame: PoseFrame): Point[] {
  const ids = [LM.leftShoulder, LM.rightShoulder, LM.leftElbow, LM.rightElbow, LM.leftHip, LM.rightHip, LM.leftAnkle]
  return ids.filter((i) => frame.landmarks[i]).map((i) => px(frame.landmarks[i], frame))
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}
