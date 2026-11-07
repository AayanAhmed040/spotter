import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLeaderboard } from '../lib/queries'
import type { LeaderboardCategory, LeaderboardRow } from '../lib/types'
import { Avatar, Badge, cx, ErrorNote, Segmented, Spinner } from './ui'

const CATEGORIES: { id: LeaderboardCategory; label: string; value: (r: LeaderboardRow) => string; hint: string }[] = [
  { id: 'topScore', label: 'Top score', value: (r) => `${Math.round(r.bestScore ?? 0)}`, hint: 'Best single-set score' },
  { id: 'mostConsistent', label: 'Most consistent', value: (r) => `${r.activeDays} days`, hint: 'Different days with a set' },
  { id: 'mostImproved', label: 'Most improved', value: (r) => `+${(r.improvement ?? 0).toFixed(1)}`, hint: 'Average score vs the period before' },
  { id: 'mostEncouraging', label: 'Most encouraging', value: (r) => `${r.cheersGiven} cheers`, hint: 'Reactions given to groupmates' },
  { id: 'mostReps', label: 'Most reps', value: (r) => `${r.totalValidReps}`, hint: 'Total valid push-ups' },
]

export function LeaderboardPanel({ groupId, myUserId }: { groupId: number; myUserId?: number }) {
  const [period, setPeriod] = useState<'week' | 'month' | 'all'>('week')
  const [category, setCategory] = useState<LeaderboardCategory>('topScore')
  const q = useLeaderboard(groupId, period)
  const cat = CATEGORIES.find((c) => c.id === category)!

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-display text-[26px] leading-none font-extrabold">Leaderboard</h2>
        <Segmented
          label="Period"
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'week', label: '7 days' },
            { value: 'month', label: '30 days' },
            { value: 'all', label: 'All time' },
          ]}
        />
      </div>

      <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist" aria-label="Recognition">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            role="tab"
            aria-selected={category === c.id}
            onClick={() => setCategory(c.id)}
            className={cx(
              'h-9 shrink-0 rounded-full border px-3.5 text-sm transition-colors',
              category === c.id ? 'border-jersey bg-jersey/10 font-semibold text-jersey' : 'border-line text-mist hover:text-chalk',
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      {q.isPending ? (
        <Spinner label="Loading leaderboard" />
      ) : q.isError ? (
        <ErrorNote error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <Board rows={q.data.rows} order={q.data.categories[category]} cat={cat} myUserId={myUserId} />
      )}
    </section>
  )
}

function Board({
  rows,
  order,
  cat,
  myUserId,
}: {
  rows: LeaderboardRow[]
  order: number[]
  cat: (typeof CATEGORIES)[number]
  myUserId?: number
}) {
  const byId = new Map(rows.map((r) => [r.user.id, r]))
  const ranked = order.map((id) => byId.get(id)!).filter(Boolean)
  const rest = rows.filter((r) => !order.includes(r.user.id))

  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] bg-court">
      <p className="px-4 pt-3 text-xs text-dim">{cat.hint}. Simulated demo sets and private sets don't count.</p>
      {ranked.length === 0 && <p className="px-4 py-6 text-center text-sm text-mist">Nobody's on this board yet for this period.</p>}
      <ol>
        {ranked.map((r, i) => (
          <li
            key={r.user.id}
            className={cx('flex items-center gap-3 px-4 py-3', i > 0 && 'border-t border-line/40', r.user.id === myUserId && 'bg-jersey/5')}
          >
            <span className={cx('w-7 text-center font-display text-3xl leading-none font-black tabular', i === 0 ? 'text-jersey' : 'text-dim')}>
              {i + 1}
            </span>
            <Link to={`/u/${r.user.username}`}>
              <Avatar user={r.user} size={40} />
            </Link>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 truncate font-semibold">
                {r.user.id === myUserId ? 'You' : r.user.displayName}
                {r.user.isDemo && <Badge>Demo</Badge>}
              </p>
              <p className="text-xs text-mist">
                {r.workouts} {r.workouts === 1 ? 'set' : 'sets'}, {r.totalValidReps} reps
                {r.averageScore !== null && `, avg ${Math.round(r.averageScore)}`}
              </p>
            </div>
            <span className="font-display text-2xl font-extrabold tabular">{cat.value(r)}</span>
          </li>
        ))}
      </ol>
      {rest.length > 0 && (
        <p className="border-t border-line/40 px-4 py-3 text-sm text-dim">
          Not on this board yet: {rest.map((r) => (r.user.id === myUserId ? 'you' : r.user.displayName.split(' ')[0])).join(', ')}
        </p>
      )}
    </div>
  )
}
