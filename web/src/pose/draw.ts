import type { FeedbackTone, Landmark } from './types'
import { LM } from './types'

const TONE_COLOR: Record<FeedbackTone, string> = {
  neutral: '#eef2f7',
  good: '#3ddc97',
  warn: '#ffc83d',
  bad: '#ff6b5b',
}

const BONES: [number, number][] = [
  [LM.leftShoulder, LM.rightShoulder],
  [LM.leftShoulder, LM.leftElbow],
  [LM.leftElbow, LM.leftWrist],
  [LM.rightShoulder, LM.rightElbow],
  [LM.rightElbow, LM.rightWrist],
  [LM.leftShoulder, LM.leftHip],
  [LM.rightShoulder, LM.rightHip],
  [LM.leftHip, LM.rightHip],
  [LM.leftHip, LM.leftKnee],
  [LM.leftKnee, LM.leftAnkle],
  [LM.rightHip, LM.rightKnee],
  [LM.rightKnee, LM.rightAnkle],
]

/** Draw the tracked skeleton. Low-visibility joints fade out so users see what the AI is unsure about. */
export function drawPose(ctx: CanvasRenderingContext2D, landmarks: Landmark[], tone: FeedbackTone, clear = true): void {
  const { width: w, height: h } = ctx.canvas
  if (clear) ctx.clearRect(0, 0, w, h)
  if (!landmarks.length) return
  const color = TONE_COLOR[tone]
  const scale = Math.max(w, h) / 1280
  ctx.lineCap = 'round'

  for (const [a, b] of BONES) {
    const p = landmarks[a]
    const q = landmarks[b]
    if (!p || !q) continue
    const v = Math.min(p.visibility ?? 1, q.visibility ?? 1)
    if (v < 0.3) continue
    ctx.globalAlpha = Math.min(1, 0.25 + v)
    ctx.strokeStyle = color
    ctx.lineWidth = 10 * scale
    ctx.beginPath()
    ctx.moveTo(p.x * w, p.y * h)
    ctx.lineTo(q.x * w, q.y * h)
    ctx.stroke()
  }
  for (const i of Object.values(LM)) {
    const p = landmarks[i]
    if (!p || (p.visibility ?? 1) < 0.3 || i === LM.nose) continue
    ctx.globalAlpha = Math.min(1, 0.25 + (p.visibility ?? 1))
    ctx.fillStyle = '#0f1b33'
    ctx.strokeStyle = color
    ctx.lineWidth = 4 * scale
    ctx.beginPath()
    ctx.arc(p.x * w, p.y * h, 9 * scale, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
  const nose = landmarks[LM.nose]
  if (nose && (nose.visibility ?? 1) >= 0.5) {
    ctx.globalAlpha = 0.9
    ctx.strokeStyle = color
    ctx.lineWidth = 6 * scale
    ctx.beginPath()
    ctx.arc(nose.x * w, nose.y * h, 26 * scale, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}

/** Background for demo mode: a floor line and a grid, so the simulated athlete reads as a scene. */
export function drawDemoScene(ctx: CanvasRenderingContext2D): void {
  const { width: w, height: h } = ctx.canvas
  ctx.fillStyle = '#132242'
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = 'rgba(155,170,203,0.08)'
  ctx.lineWidth = 1
  for (let x = 0; x < w; x += 64) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
    ctx.stroke()
  }
  const floor = h * 0.845
  ctx.fillStyle = '#1c2f59'
  ctx.fillRect(0, floor, w, h - floor)
}
