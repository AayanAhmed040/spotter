/**
 * Runs a workout: pulls frames (camera + MediaPipe, or the simulator), feeds the
 * detector, draws the overlay, and tracks active time. Lives outside React so the
 * 30–60 fps loop never triggers re-renders; the UI subscribes to throttled snapshots.
 */
import type { PoseLandmarker } from '@mediapipe/tasks-vision'
import { drawDemoScene, drawPose } from './draw'
import { loadPoseLandmarker, openCamera, type CameraFacing } from './mediapipe'
import { PushupDetector } from './pushupDetector'
import { mulberry32, poseAt, SIM_HEIGHT, SIM_WIDTH, type AthleteProfile } from './simulator'
import type { DetectorSnapshot, Landmark, ScoredRep } from './types'

export type SessionStatus = 'idle' | 'loading' | 'running' | 'paused' | 'finished' | 'error'

export interface SessionView {
  status: SessionStatus
  snapshot: DetectorSnapshot
  activeMs: number
  fps: number
  error: Error | null
}

export interface SessionResult {
  startedAt: string
  durationMs: number
  reps: ScoredRep[]
}

export type SessionMode = { kind: 'camera'; facing: CameraFacing } | { kind: 'demo'; athlete: AthleteProfile }

const EMPTY: DetectorSnapshot = {
  phase: 'searching',
  validReps: 0,
  attemptedReps: 0,
  elbowAngle: null,
  feedback: { message: 'Getting ready', tone: 'neutral' },
  trackingQuality: 0,
  lastRep: null,
}

export class WorkoutSession {
  private detector = new PushupDetector()
  private landmarker: PoseLandmarker | null = null
  private stream: MediaStream | null = null
  private raf = 0
  private lastVideoTime = -1
  private activeMs = 0
  private lastTick = 0
  private startedAt: Date | null = null
  private demoClock = 0
  private demoRand = mulberry32(Date.now() % 100000)
  private frames = 0
  private fpsWindowStart = 0
  private fps = 0
  private lastEmit = 0
  private view: SessionView = { status: 'idle', snapshot: EMPTY, activeMs: 0, fps: 0, error: null }
  private listeners = new Set<(v: SessionView) => void>()

  private mode: SessionMode
  private video: HTMLVideoElement | null
  private canvas: HTMLCanvasElement

  constructor(mode: SessionMode, video: HTMLVideoElement | null, canvas: HTMLCanvasElement) {
    this.mode = mode
    this.video = video
    this.canvas = canvas
  }

  subscribe(fn: (v: SessionView) => void): () => void {
    this.listeners.add(fn)
    fn(this.view)
    return () => this.listeners.delete(fn)
  }

  async start(): Promise<void> {
    this.set({ status: 'loading', error: null })
    try {
      if (this.mode.kind === 'camera') {
        if (!this.video) throw new Error('Video element missing')
        // Load model and camera in parallel — both take a moment.
        const [landmarker, stream] = await Promise.all([loadPoseLandmarker(), openCamera(this.mode.facing)])
        this.landmarker = landmarker
        this.stream = stream
        this.video.srcObject = stream
        this.video.muted = true
        this.video.playsInline = true
        await this.video.play()
        await waitForVideo(this.video)
        this.canvas.width = this.video.videoWidth
        this.canvas.height = this.video.videoHeight
      } else {
        this.canvas.width = SIM_WIDTH
        this.canvas.height = SIM_HEIGHT
      }
    } catch (e) {
      this.stopMedia()
      this.set({ status: 'error', error: e as Error })
      return
    }
    this.startedAt = new Date()
    this.lastTick = performance.now()
    this.fpsWindowStart = this.lastTick
    this.set({ status: 'running' })
    this.loop()
  }

  pause(): void {
    if (this.view.status !== 'running') return
    this.tickTime()
    cancelAnimationFrame(this.raf)
    this.video?.pause()
    this.set({ status: 'paused' })
  }

  resume(): void {
    if (this.view.status !== 'paused') return
    this.detector.interrupt()
    void this.video?.play()
    this.lastTick = performance.now()
    this.set({ status: 'running' })
    this.loop()
  }

  finish(): SessionResult {
    if (this.view.status === 'running') this.tickTime()
    cancelAnimationFrame(this.raf)
    this.stopMedia()
    this.set({ status: 'finished' })
    return {
      startedAt: (this.startedAt ?? new Date()).toISOString(),
      durationMs: Math.max(1000, Math.round(this.activeMs)),
      reps: [...this.detector.reps],
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.raf)
    this.stopMedia()
    this.listeners.clear()
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop)
    const now = performance.now()
    this.tickTime(now)
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return

    let landmarks: Landmark[] | null = null
    let width = this.canvas.width
    let height = this.canvas.height

    if (this.mode.kind === 'camera') {
      const v = this.video!
      if (v.readyState < 2 || v.currentTime === this.lastVideoTime) return // no new frame yet
      this.lastVideoTime = v.currentTime
      const result = this.landmarker!.detectForVideo(v, now)
      landmarks = result.landmarks[0] ?? []
      width = v.videoWidth
      height = v.videoHeight
    } else {
      this.demoClock = this.activeMs
      landmarks = poseAt(this.mode.athlete, this.demoClock, this.demoRand).landmarks
      width = SIM_WIDTH
      height = SIM_HEIGHT
    }

    const snapshot = this.detector.update({ landmarks, timestampMs: now, width, height })
    if (this.mode.kind === 'demo') {
      drawDemoScene(ctx)
      drawPose(ctx, landmarks, snapshot.feedback.tone, false)
    } else {
      drawPose(ctx, landmarks, snapshot.feedback.tone)
    }

    this.frames++
    if (now - this.fpsWindowStart > 1000) {
      this.fps = Math.round((this.frames * 1000) / (now - this.fpsWindowStart))
      this.frames = 0
      this.fpsWindowStart = now
    }
    // ~12 UI updates per second is plenty; emit immediately when a rep lands.
    const repChanged = snapshot.attemptedReps !== this.view.snapshot.attemptedReps
    if (repChanged || now - this.lastEmit > 80) {
      this.lastEmit = now
      this.set({ snapshot, activeMs: this.activeMs, fps: this.fps })
    }
  }

  private tickTime(now = performance.now()): void {
    this.activeMs += now - this.lastTick
    this.lastTick = now
  }

  private stopMedia(): void {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    if (this.video) this.video.srcObject = null
  }

  private set(patch: Partial<SessionView>): void {
    this.view = { ...this.view, ...patch }
    for (const fn of this.listeners) fn(this.view)
  }
}

function waitForVideo(v: HTMLVideoElement): Promise<void> {
  if (v.videoWidth > 0) return Promise.resolve()
  return new Promise((resolve) => v.addEventListener('loadedmetadata', () => resolve(), { once: true }))
}
