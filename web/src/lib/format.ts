export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  if (d === 1) return 'yesterday'
  if (d < 7) return `${d} days ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function score(v: number | null | undefined): string {
  return v === null || v === undefined ? '–' : String(Math.round(v))
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n} ${n === 1 ? word : pluralWord}`
}

export function confidenceLabel(c: number): { label: string; tone: 'good' | 'warn' | 'bad' } {
  if (c >= 0.75) return { label: 'High tracking confidence', tone: 'good' }
  if (c >= 0.5) return { label: 'Medium tracking confidence', tone: 'warn' }
  return { label: 'Low tracking confidence', tone: 'bad' }
}

/** "1:30" for 90 000 ms. */
export function holdTime(ms: number | null | undefined): string {
  return clock(ms ?? 0)
}
