/** Deterministic randomness for the test simulators. */

/** Seeded PRNG (mulberry32) so tests are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-9)
  const v = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/** Perpendicular offset that bends a straight line of segments a and b by `devDeg` at the joint. */
export function offsetForBend(devDeg: number, a: number, b: number): number {
  if (devDeg <= 0) return 0
  const target = (devDeg * Math.PI) / 180
  let lo = 0
  let hi = Math.min(a, b)
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (Math.atan(mid / a) + Math.atan(mid / b) < target) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}
