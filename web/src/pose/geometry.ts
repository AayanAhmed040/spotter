export interface Point {
  x: number
  y: number
}

const RAD = 180 / Math.PI

/** Angle ABC at vertex B, in degrees [0, 180]. */
export function jointAngle(a: Point, b: Point, c: Point): number {
  const v1x = a.x - b.x
  const v1y = a.y - b.y
  const v2x = c.x - b.x
  const v2y = c.y - b.y
  const n1 = Math.hypot(v1x, v1y)
  const n2 = Math.hypot(v2x, v2y)
  if (n1 === 0 || n2 === 0) return 180
  const cos = (v1x * v2x + v1y * v2y) / (n1 * n2)
  return Math.acos(Math.max(-1, Math.min(1, cos))) * RAD
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** Angle of segment a→b from horizontal, in degrees [0, 90]. */
export function tiltFromHorizontal(a: Point, b: Point): number {
  const dx = Math.abs(b.x - a.x)
  const dy = Math.abs(b.y - a.y)
  return Math.atan2(dy, dx) * RAD
}

/**
 * Signed perpendicular offset of p from the line a→b, as a fraction of |ab|.
 * Positive means p is on the floor side (larger image y), i.e. hips sagging.
 */
export function signedOffsetTowardFloor(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return 0
  // Unit normal; flip so it points "down" in image space.
  let nx = -dy / len
  let ny = dx / len
  if (ny < 0) {
    nx = -nx
    ny = -ny
  }
  return ((p.x - a.x) * nx + (p.y - a.y) * ny) / len
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((s, v) => s + v, 0) / values.length
}

export function stdev(values: number[]): number {
  if (values.length < 2) return 0
  const m = mean(values)
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)))
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
