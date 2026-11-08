import { holdTime } from '../lib/format'
import type { CalendarDay } from '../lib/types'
import { cx } from './ui'

function describeDay(d: CalendarDay): string {
  const parts = [`${d.workouts} workout${d.workouts > 1 ? 's' : ''}`]
  if (d.reps) parts.push(`${d.reps} reps`)
  if (d.holdMs) parts.push(`${holdTime(d.holdMs)} of planking`)
  return parts.join(', ')
}

const HEAT = ['bg-heat-0', 'bg-heat-1', 'bg-heat-2', 'bg-heat-3', 'bg-heat-4']

/**
 * GitHub-style consistency grid: one column per week, Monday at the top.
 * Colour encodes how much you did, but any activity at all shows green —
 * showing up is what's being celebrated.
 */
export function ActivityCalendar({
  days,
  selected,
  onSelect,
}: {
  days: CalendarDay[]
  selected: string | null
  onSelect: (date: string | null) => void
}) {
  if (!days.length) return null
  const first = new Date(days[0].date + 'T00:00:00')
  const lead = (first.getDay() + 6) % 7 // Monday = 0
  const cells: (CalendarDay | null)[] = [...Array(lead).fill(null), ...days]
  const weeks = Math.ceil(cells.length / 7)

  // Month labels at the first column whose Monday falls in a new month.
  const labels: { col: number; text: string }[] = []
  let lastMonth = -1
  for (let col = 0; col < weeks; col++) {
    const day = cells[col * 7] ?? cells[col * 7 + lead]
    if (!day) continue
    const m = new Date(day.date + 'T00:00:00').getMonth()
    if (m !== lastMonth) {
      if (col < weeks - 1) labels.push({ col, text: new Date(day.date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short' }) })
      lastMonth = m
    }
  }

  return (
    <div>
      <div className="grid gap-[3px] text-[10px] text-dim" style={{ gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))` }} aria-hidden>
        {Array.from({ length: weeks }, (_, col) => (
          <span key={col} className="h-4 overflow-visible whitespace-nowrap">
            {labels.find((l) => l.col === col)?.text ?? ''}
          </span>
        ))}
      </div>
      <div
        role="grid"
        aria-label="Workout activity by day"
        className="grid grid-flow-col gap-[3px]"
        style={{ gridTemplateRows: 'repeat(7, minmax(0, 1fr))', gridAutoColumns: 'minmax(0, 1fr)' }}
      >
        {cells.map((d, i) =>
          d ? (
            <button
              key={d.date}
              onClick={() => onSelect(selected === d.date ? null : d.date)}
              aria-label={`${new Date(d.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}: ${
                d.workouts ? describeDay(d) : 'rest day'
              }`}
              aria-pressed={selected === d.date}
              className={cx(
                'aspect-square w-full rounded-[3px] transition-transform hover:scale-125',
                HEAT[d.level],
                selected === d.date && 'ring-2 ring-accent ring-offset-1 ring-offset-court',
              )}
            />
          ) : (
            <span key={`pad-${i}`} aria-hidden />
          ),
        )}
      </div>
      <div className="mt-3 flex items-center justify-end gap-1.5 text-[11px] text-dim">
        Rest
        {HEAT.map((c) => (
          <span key={c} className={cx('size-3 rounded-[3px]', c)} aria-hidden />
        ))}
        More
      </div>
    </div>
  )
}
