import { Clock, Lock } from 'lucide-react'
import { Link } from 'react-router-dom'
import { exerciseMeta } from '../exercises/meta'
import { clock, holdTime, timeAgo } from '../lib/format'
import { useToggleReaction } from '../lib/queries'
import type { ReactionKind, Workout } from '../lib/types'
import { Avatar, Badge, cx } from './ui'

export const REACTIONS: { kind: ReactionKind; emoji: string; label: string }[] = [
  { kind: 'strong', emoji: '💪', label: 'Strong' },
  { kind: 'fire', emoji: '🔥', label: 'On fire' },
  { kind: 'clap', emoji: '👏', label: 'Nice work' },
  { kind: 'form', emoji: '🎯', label: 'Great form' },
]

/** A feed post, laid out like a scorecard: the final score is the headline. */
export function WorkoutCard({ w }: { w: Workout }) {
  const react = useToggleReaction()
  const meta = exerciseMeta(w.exercise)
  const isHold = w.metricKind === 'hold'
  const scoreTone = w.finalScore >= 85 ? 'text-go' : w.finalScore >= 65 ? 'text-accent' : 'text-chalk'
  const reps = w.validReps ?? 0
  const stats: { label: string; value: string; sub?: string; icon?: boolean }[] = isHold
    ? [
        { label: 'held', value: holdTime(w.holdMs) },
        { label: 'form', value: String(Math.round(w.formScore)) },
        w.longestHoldMs && w.holdMs && w.longestHoldMs < w.holdMs - 999
          ? { label: 'longest', value: holdTime(w.longestHoldMs) }
          : { label: 'time', value: clock(w.durationMs), icon: true },
      ]
    : [
        {
          label: reps === 1 ? meta.singular : meta.plural,
          value: String(reps),
          sub: (w.attemptedReps ?? 0) > reps ? `of ${w.attemptedReps}` : undefined,
        },
        { label: 'form', value: String(Math.round(w.formScore)) },
        { label: 'time', value: clock(w.durationMs), icon: true },
      ]

  return (
    <article className="overflow-hidden rounded-[var(--radius-card)] bg-court">
      <header className="flex items-center gap-3 px-4 pt-4">
        <Link to={`/u/${w.user.username}`} className="shrink-0">
          <Avatar user={w.user} size={40} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <Link to={`/u/${w.user.username}`} className="truncate font-semibold hover:underline">
              {w.isMine ? 'You' : w.user.displayName}
            </Link>
            {w.user.isDemo && <Badge>Demo account</Badge>}
            {w.source === 'demo' && <Badge tone="sim">Simulated</Badge>}
            {w.visibility === 'private' && (
              <Badge>
                <Lock className="size-3" aria-hidden /> Only you
              </Badge>
            )}
          </div>
          <p className="text-xs text-dim">
            <span className="font-medium text-mist">{meta.name}</span>
            <span aria-hidden> — </span>
            <time dateTime={w.startedAt} title={new Date(w.startedAt).toLocaleString()}>
              {timeAgo(w.startedAt)}
            </time>
          </p>
        </div>
      </header>

      <div className="flex items-end gap-5 px-4 pt-3 pb-4">
        <div className="shrink-0">
          <div className={cx('font-display text-[56px] leading-[0.8] font-bold tabular', scoreTone)}>{Math.round(w.finalScore)}</div>
          <div className="mt-2 text-xs text-mist">score</div>
        </div>
        <dl className="grid flex-1 grid-cols-3 gap-2 text-center">
          {stats.map((s) => (
            <Stat key={s.label} {...s} />
          ))}
        </dl>
      </div>

      {w.note && <p className="px-4 pb-3 text-[15px]">{w.note}</p>}

      <footer className="flex gap-1.5 border-t border-line/50 px-3 py-2">
        {REACTIONS.map((r) => {
          const count = w.reactions[r.kind] ?? 0
          const mine = w.myReactions.includes(r.kind)
          return (
            <button
              key={r.kind}
              onClick={() => react.mutate({ id: w.id, kind: r.kind })}
              aria-pressed={mine}
              aria-label={`${r.label}${count ? `, ${count}` : ''}`}
              className={cx(
                'flex h-9 min-w-11 items-center justify-center gap-1 rounded-full px-2.5 text-sm transition-colors',
                mine ? 'bg-accent/15 text-accent ring-1 ring-accent/40' : 'text-mist hover:bg-court-hi',
              )}
            >
              <span aria-hidden>{r.emoji}</span>
              {count > 0 && <span className="tabular">{count}</span>}
            </button>
          )
        })}
      </footer>
    </article>
  )
}

function Stat({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon?: boolean }) {
  return (
    <div className="rounded-xl bg-ink/40 px-1 py-2">
      <dd className="font-display text-2xl leading-none font-semibold tabular">
        {value}
        {sub && <span className="ml-1 font-sans text-xs font-normal text-dim">{sub}</span>}
      </dd>
      <dt className="mt-1 flex items-center justify-center gap-1 text-[11px] text-mist">
        {icon && <Clock className="size-3" aria-hidden />}
        {label}
      </dt>
    </div>
  )
}
