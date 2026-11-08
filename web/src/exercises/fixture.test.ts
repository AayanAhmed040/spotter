import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getExercise } from '.'
import type { Recording } from './shared/types'

/** shared/scoring-cases.json is also checked by api/tests — the two scorers must agree. */
const fixture = JSON.parse(readFileSync(new URL('../../../shared/scoring-cases.json', import.meta.url), 'utf8'))

describe('shared scoring fixture', () => {
  for (const c of fixture.cases) {
    it(`${c.exercise}: ${c.name}`, () => {
      const rec: Recording = c.holdWindows ? { kind: 'hold', windows: c.holdWindows } : { kind: 'reps', reps: c.reps }
      const s = getExercise(c.exercise).score(rec, c.target)
      expect(s.formScore).toBeCloseTo(c.expected.formScore, 1)
      expect(s.finalScore).toBeCloseTo(c.expected.finalScore, 1)
      if (s.kind === 'reps') expect(s.validReps).toBe(c.expected.validReps)
      else expect(s.holdMs).toBe(c.expected.holdMs)
    })
  }
})
