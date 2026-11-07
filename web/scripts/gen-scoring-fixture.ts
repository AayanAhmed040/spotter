/**
 * Regenerates shared/scoring-cases.json from the TypeScript scorer.
 * Run after changing SCORING, then make sure `pytest` in api/ still passes —
 * that's what keeps the Python scorer in lockstep.
 *   npx tsx scripts/gen-scoring-fixture.ts
 */
import { writeFileSync } from 'node:fs'
import { scoreRep, scoreSession, SCORING_VERSION } from '../src/pose/scoring'
import type { RepMeasurement } from '../src/pose/types'

const base: RepMeasurement = {
  index: 1, valid: true, invalidReason: null, startMs: 0, durationMs: 1200,
  minElbowAngle: 85, topElbowAngle: 168, meanBodyDeviation: 5, maxBodyDeviation: 8,
  hipFault: null, confidence: 0.9, usedKneesForAlignment: false,
}
const reps = (n: number, f: (i: number) => Partial<RepMeasurement>) =>
  Array.from({ length: n }, (_, i) => ({ ...base, index: i + 1, ...f(i) }))

const cases = [
  { name: 'perfect 20 of 20', targetReps: 20, reps: reps(20, () => ({})) },
  { name: 'single shallow rep', targetReps: 20, reps: reps(1, () => ({ minElbowAngle: 104 })) },
  { name: 'mixed quality with invalid reps', targetReps: 20, reps: reps(12, (i) => ({
      minElbowAngle: 84 + i * 1.8, meanBodyDeviation: 4 + i * 1.7, durationMs: 1300 - i * 60,
      confidence: 0.6 + (i % 4) * 0.1, valid: i % 5 !== 4, invalidReason: i % 5 === 4 ? 'Not deep enough' : null,
      hipFault: i > 6 ? 'sag' : null,
    })) },
  { name: 'over target with fatigue', targetReps: 10, reps: reps(16, (i) => ({
      meanBodyDeviation: 3 + i * 2, topElbowAngle: 170 - i, durationMs: 900 - i * 25,
    })) },
  { name: 'nothing valid', targetReps: 20, reps: reps(3, () => ({ valid: false, invalidReason: 'Not deep enough', minElbowAngle: 125 })) },
].map((c) => {
  const s = scoreSession(c.reps.map(scoreRep), c.targetReps)
  return { ...c, expected: { formScore: s.formScore, repScore: s.repScore, finalScore: s.finalScore, validReps: s.validReps } }
})

writeFileSync(new URL('../../shared/scoring-cases.json', import.meta.url), JSON.stringify({ scoringVersion: SCORING_VERSION, cases }, null, 2) + '\n')
console.log(cases.map((c) => `${c.name}: ${JSON.stringify(c.expected)}`).join('\n'))
