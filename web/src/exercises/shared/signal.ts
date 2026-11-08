/** Small, reusable signal helpers used by the exercise trackers. */
import { clamp, distance, mean, type Point } from './geometry'
import type { FeedbackTone, LiveFeedback } from './types'

/** Exponential moving average. `alpha` near 1 = heavy smoothing. */
export class Ema {
  private value: number | null = null
  private alpha: number
  constructor(alpha: number) {
    this.alpha = alpha
  }
  push(v: number): number {
    this.value = this.value === null ? v : this.alpha * this.value + (1 - this.alpha) * v
    return this.value
  }
  get(): number | null {
    return this.value
  }
  reset(): void {
    this.value = null
  }
}

/**
 * Landmark stability: real movement is slow relative to the frame rate, so
 * large frame-to-frame jumps (relative to body size) mean unreliable tracking.
 */
export class StabilityTracker {
  private prev: Point[] | null = null
  private value = 1
  update(points: Point[], bodySize: number): number {
    if (this.prev && points.length === this.prev.length && bodySize > 0) {
      const prev = this.prev
      const jitter = mean(points.map((p, i) => distance(p, prev[i]))) / bodySize
      const frame = clamp(1 - Math.max(0, jitter - 0.015) * 12, 0, 1)
      this.value = this.value * 0.8 + frame * 0.2
    }
    this.prev = points
    return this.value
  }
  get(): number {
    return this.value
  }
  reset(): void {
    this.prev = null
    this.value = 1
  }
}

/** Coaching message with a minimum display time, so "Great rep!" isn't overwritten instantly. */
export class FeedbackChannel {
  private current: LiveFeedback
  private holdUntil = 0
  constructor(initial: LiveFeedback) {
    this.current = initial
  }
  say(message: string, tone: FeedbackTone, t: number, holdMs = 0): void {
    if (t < this.holdUntil && holdMs === 0) return
    this.current = { message, tone }
    if (holdMs > 0) this.holdUntil = t + holdMs
  }
  force(message: string, tone: FeedbackTone): void {
    this.current = { message, tone }
    this.holdUntil = 0
  }
  get(): LiveFeedback {
    return this.current
  }
  held(t: number): boolean {
    return t < this.holdUntil
  }
}

export function round1(v: number): number {
  return Math.round(v * 10) / 10
}
