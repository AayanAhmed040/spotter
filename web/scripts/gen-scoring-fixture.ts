/**
 * Regenerates shared/scoring-cases.json from the TypeScript scorers.
 * Run after changing any scoring config, then make sure `pytest` in api/ still
 * passes — that's what keeps the Python scorers in lockstep.
 *   npx tsx scripts/gen-scoring-fixture.ts
 */
import { writeFileSync } from 'node:fs'
import { getExercise } from '../src/exercises'
import type { HoldWindow, Recording } from '../src/exercises/shared/types'

type Case = { name: string; exercise: string; target: number; recording: Recording }

const pushup = (i: number, o: Record<string, unknown> = {}) => ({
  index: i + 1, valid: true, invalidReason: null, startMs: i * 1500, durationMs: 1200,
  minElbowAngle: 85, topElbowAngle: 168, meanBodyDeviation: 5, maxBodyDeviation: 8,
  hipFault: null, confidence: 0.9, usedKneesForAlignment: false, ...o,
})
const squat = (i: number, o: Record<string, unknown> = {}) => ({
  index: i + 1, valid: true, invalidReason: null, startMs: i * 2500, durationMs: 2000,
  minKneeAngle: 62, topKneeAngle: 174, maxTorsoLean: 32, meanTorsoLean: 18,
  reachedParallel: true, frontView: false, confidence: 0.88, ...o,
})
const win = (i: number, o: Partial<HoldWindow> = {}): HoldWindow => ({
  segment: 0, startMs: i * 5000, durationMs: 5000, meanBodyDeviation: 4, meanStackOffset: 0.12,
  hipSway: 0.005, sagShare: 0, pikeShare: 0, confidence: 0.9, ...o,
})
const reps = (n: number, f: (i: number) => Record<string, unknown>) => ({ kind: 'reps' as const, reps: Array.from({ length: n }, (_, i) => f(i)) as never })
const hold = (ws: HoldWindow[]): Recording => ({ kind: 'hold', windows: ws })

const cases: Case[] = [
  // Push-ups (names kept from earlier fixture versions)
  { name: 'perfect 20 of 20', exercise: 'pushup', target: 20, recording: reps(20, (i) => pushup(i)) },
  { name: 'single shallow rep', exercise: 'pushup', target: 20, recording: reps(1, (i) => pushup(i, { minElbowAngle: 104 })) },
  { name: 'mixed quality with invalid reps', exercise: 'pushup', target: 20, recording: reps(12, (i) => pushup(i, {
      minElbowAngle: 84 + i * 1.8, meanBodyDeviation: 4 + i * 1.7, durationMs: 1300 - i * 60,
      confidence: 0.6 + (i % 4) * 0.1, valid: i % 5 !== 4, invalidReason: i % 5 === 4 ? 'Not deep enough' : null,
      hipFault: i > 6 ? 'sag' : null })) },
  { name: 'over target with fatigue', exercise: 'pushup', target: 10, recording: reps(16, (i) => pushup(i, {
      meanBodyDeviation: 3 + i * 2, topElbowAngle: 170 - i, durationMs: 900 - i * 25 })) },
  { name: 'nothing valid', exercise: 'pushup', target: 20, recording: reps(3, (i) => pushup(i, { valid: false, invalidReason: 'Not deep enough', minElbowAngle: 125 })) },
  // Squats
  { name: 'squats: clean 15 of 20', exercise: 'squat', target: 20, recording: reps(15, (i) => squat(i)) },
  { name: 'squats: leaning, shallowing, rushed', exercise: 'squat', target: 15, recording: reps(15, (i) => squat(i, {
      minKneeAngle: 60 + i * 3, maxTorsoLean: 30 + i * 2.5, durationMs: 2100 - i * 90, confidence: 0.55 + (i % 3) * 0.15 })) },
  { name: 'squats: client-valid but too shallow', exercise: 'squat', target: 20, recording: reps(4, (i) => squat(i, { minKneeAngle: 118 })) },
  // Planks (target in seconds)
  { name: 'plank: 60 s clean', exercise: 'plank', target: 60, recording: hold(Array.from({ length: 12 }, (_, i) => win(i))) },
  { name: 'plank: fatigue, two holds, one blurry window', exercise: 'plank', target: 60, recording: hold([
      ...Array.from({ length: 6 }, (_, i) => win(i, { meanBodyDeviation: 4 + i * 2.5, hipSway: 0.005 + i * 0.002, sagShare: i > 3 ? 0.7 : 0 })),
      win(6, { segment: 1, confidence: 0.3 }),
      ...Array.from({ length: 3 }, (_, i) => win(7 + i, { segment: 1, meanStackOffset: 0.4 + i * 0.1, durationMs: 4200 })),
    ]) },
  { name: 'plank: short hold under target', exercise: 'plank', target: 90, recording: hold([win(0, { durationMs: 3400 }), win(1, { durationMs: 2100, meanBodyDeviation: 14 })]) },
]

const out = cases.map((c) => {
  const s = getExercise(c.exercise).score(c.recording, c.target)
  const expected =
    s.kind === 'reps'
      ? { formScore: s.formScore, volumeScore: s.repScore, finalScore: s.finalScore, validReps: s.validReps }
      : { formScore: s.formScore, volumeScore: s.holdScore, finalScore: s.finalScore, holdMs: s.holdMs, longestHoldMs: s.longestHoldMs }
  const payload = c.recording.kind === 'reps' ? { reps: c.recording.reps } : { holdWindows: c.recording.windows }
  return { name: c.name, exercise: c.exercise, target: c.target, ...payload, expected }
})

writeFileSync(new URL('../../shared/scoring-cases.json', import.meta.url), JSON.stringify({ version: 2, cases: out }, null, 2) + '\n')
console.log(out.map((c) => `${c.exercise.padEnd(6)} ${c.name}: ${JSON.stringify(c.expected)}`).join('\n'))
