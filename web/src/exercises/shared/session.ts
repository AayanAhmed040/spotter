/**
 * Runs a live workout for any exercise: camera → MediaPipe → the exercise's
 * tracker → overlay. Lives outside React so the 30–60 fps loop never triggers
 * re-renders; the UI subscribes to throttled views.
 */
import type { PoseLandmarker } from '@mediapipe/tasks-vision'
import { drawPose } from './draw'
import { loadPoseLandmarker, openCamera, type CameraFacing } from './mediapipe'
import type { ExerciseTracker, LiveState, Recording } from './types'

export type SessionStatus = 'idle' | 'loading' | 'running' | 'paused' | 'finished' | 'error'

export interface SessionView {
  status: SessionStatus
  live: LiveState
  activeMs: number
  fps: number
  /** Environment problems spotted from the video itself (e.g. too dark). */
  environment: 'dark' | null
  error: Error | null
}

export interface SessionResult {
  startedAt: string
  durationMs: number
  recording: Recording
}

const EMPTY: LiveState = {
  phase: 'searching',
  feedback: { message: 'Getting ready', tone: 'neutral' },
  trackingQuality: 0,
  readouts: [],
}

export class WorkoutSession {
  private tracker: ExerciseTracker
  private facing: CameraFacing
  private video: HTMLVideoElement
  private canvas: HTMLCanvasElement
  private landmarker: PoseLandmarker | null = null
  private stream: MediaStream | null = null
  private raf = 0
  private lastVideoTime = -1
  private lastDetectTs = 0
  private activeMs = 0
  private lastTick = 0
  private startedAt: Date | null = null
  private frames = 0
  private fpsWindowStart = 0
  private fps = 0
  private lastEmit = 0
  private lastLightCheck = 0
  private lumaCanvas: HTMLCanvasElement | null = null
  private view: SessionView = { status: 'idle', live: EMPTY, activeMs: 0, fps: 0, environment: null, error: null }
  private listeners = new Set<(v: SessionView) => void>()

  constructor(tracker: ExerciseTracker, facing: CameraFacing, video: HTMLVideoElement, canvas: HTMLCanvasElement) {
    this.tracker = tracker
    this.facing = facing
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
      // Load the model and open the camera in parallel — both take a moment.
      const [landmarker, stream] = await Promise.all([loadPoseLandmarker(), openCamera(this.facing)])
      this.landmarker = landmarker
      this.stream = stream
      this.video.srcObject = stream
      this.video.muted = true
      this.video.playsInline = true
      await this.video.play()
      await waitForVideo(this.video)
      this.canvas.width = this.video.videoWidth
      this.canvas.height = this.video.videoHeight
    } catch (e) {
      this.stopMedia()
      this.set({ status: 'error', error: e as Error })
      return
    }
    this.startedAt ??= new Date()
    this.lastTick = performance.now()
    this.fpsWindowStart = this.lastTick
    this.set({ status: 'running' })
    this.loop()
  }

  pause(): void {
    if (this.view.status !== 'running') return
    this.tickTime()
    cancelAnimationFrame(this.raf)
    this.video.pause()
    this.set({ status: 'paused' })
  }

  resume(): void {
    if (this.view.status !== 'paused') return
    this.tracker.interrupt()
    void this.video.play()
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
      recording: this.tracker.recording(),
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
    const v = this.video
    if (!ctx || v.readyState < 2 || v.currentTime === this.lastVideoTime) return // no new frame yet
    this.lastVideoTime = v.currentTime
    // MediaPipe requires strictly increasing timestamps.
    const ts = Math.max(now, this.lastDetectTs + 1)
    this.lastDetectTs = ts

    let landmarks
    try {
      landmarks = this.landmarker!.detectForVideo(v, ts).landmarks[0] ?? []
    } catch (e) {
      console.error('Pose detection failed', e)
      this.pause()
      this.set({ status: 'error', error: new Error('Pose tracking stopped unexpectedly. Your set so far is kept — finish it or try again.') })
      return
    }
    const live = this.tracker.update({ landmarks, timestampMs: ts, width: v.videoWidth, height: v.videoHeight })
    drawPose(ctx, landmarks, live.feedback.tone)

    if (now - this.lastLightCheck > 1500) {
      this.lastLightCheck = now
      this.view.environment = this.isTooDark() ? 'dark' : null
    }

    this.frames++
    if (now - this.fpsWindowStart > 1000) {
      this.fps = Math.round((this.frames * 1000) / (now - this.fpsWindowStart))
      this.frames = 0
      this.fpsWindowStart = now
    }
    // ~12 UI updates per second is plenty; emit immediately when a rep lands.
    const repChanged = live.attemptedReps !== this.view.live.attemptedReps
    if (repChanged || now - this.lastEmit > 80) {
      this.lastEmit = now
      this.set({ live, activeMs: this.activeMs, fps: this.fps })
    }
  }

  /** Average brightness of a tiny downscaled frame. Very dark video makes pose tracking unreliable. */
  private isTooDark(): boolean {
    try {
      this.lumaCanvas ??= document.createElement('canvas')
      const c = this.lumaCanvas
      c.width = 32
      c.height = 18
      const ctx = c.getContext('2d', { willReadFrequently: true })
      if (!ctx) return false
      ctx.drawImage(this.video, 0, 0, 32, 18)
      const d = ctx.getImageData(0, 0, 32, 18).data
      let sum = 0
      for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
      return sum / (d.length / 4) < 45
    } catch {
      return false
    }
  }

  private tickTime(now = performance.now()): void {
    this.activeMs += now - this.lastTick
    this.lastTick = now
  }

  private stopMedia(): void {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.video.srcObject = null
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
