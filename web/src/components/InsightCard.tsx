import { RefreshCw, Sparkles } from 'lucide-react'
import { useInsight, useRefreshInsight } from '../lib/queries'
import { Badge, Button, ErrorNote } from './ui'

/** Weekly summary written by Gemini from aggregate stats only. */
export function InsightCard() {
  const q = useInsight(true)
  const refresh = useRefreshInsight()
  const i = refresh.data ?? q.data

  return (
    <section className="rounded-[var(--radius-card)] bg-court p-4 ring-1 ring-sky/25" aria-busy={q.isPending}>
      <div className="flex items-center justify-between gap-2">
        {i?.source === 'gemini' ? (
          <Badge tone="ai">
            <Sparkles className="size-3" aria-hidden /> Weekly insight by Gemini
          </Badge>
        ) : (
          <Badge>Weekly summary</Badge>
        )}
        <Button variant="ghost" size="sm" onClick={() => refresh.mutate()} loading={refresh.isPending} aria-label="Refresh insight">
          <RefreshCw className="size-4" aria-hidden />
        </Button>
      </div>
      {q.isPending ? (
        <div className="mt-3 space-y-2" aria-hidden>
          <div className="h-6 w-2/3 animate-pulse rounded bg-court-hi" />
          <div className="h-4 w-full animate-pulse rounded bg-court-hi" />
          <div className="h-4 w-5/6 animate-pulse rounded bg-court-hi" />
        </div>
      ) : q.isError ? (
        <div className="mt-3">
          <ErrorNote error={q.error} onRetry={() => q.refetch()} />
        </div>
      ) : i ? (
        <>
          <h3 className="mt-2 font-display text-[26px] leading-tight font-semibold tracking-tight">{i.headline}</h3>
          <p className="mt-2 text-[15px] text-mist">{i.summary}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-sm font-semibold">Going well</p>
              <ul className="mt-1 space-y-1 text-sm text-mist">
                {i.highlights.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-sm font-semibold">Try next</p>
              <ul className="mt-1 space-y-1 text-sm text-mist">
                {i.nextSteps.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            </div>
          </div>
          <p className="mt-3 text-[11px] text-dim">
            {i.source === 'gemini'
              ? `AI-generated (${i.aiModel}) from your weekly totals only — no names, photos or video are shared. Not medical advice.`
              : 'Written from your weekly totals by built-in rules (Gemini is not configured or was unavailable).'}
          </p>
        </>
      ) : null}
    </section>
  )
}
