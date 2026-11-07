import { useEffect, useRef, useState } from 'react'
import { WorkoutSession, type SessionView } from '../pose/session'
import { ATHLETES } from '../pose/simulator'
import { cx } from './ui'

/**
 * A simulated athlete running through the real detector and scorer.
 * Used on the landing page and as the workout screen's demo mode.
 */
export function LiveDemo({ compact = false }: { compact?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [athleteId, setAthleteId] = useState(ATHLETES[0].id)
  const [view, setView] = useState<SessionView | null>(null)
  const [pop, setPop] = useState(0)
  const [cycle, setCycle] = useState(0)

  useEffect(() => {
    const athlete = ATHLETES.find((a) => a.id === athleteId)!
    const s = new WorkoutSession({ kind: 'demo', athlete }, null, canvas.current!)
    let last = 0
    let restarting = false
    const unsub = s.subscribe((v) => {
      setView(v)
      if (v.snapshot.attemptedReps !== last) {
        last = v.snapshot.attemptedReps
        setPop((p) => p + 1)
      }
      // Start a fresh set after 12 reps so the demo loops.
      if (v.snapshot.attemptedReps >= 12 && !restarting) {
        restarting = true
        setTimeout(() => setCycle((c) => c + 1), 1200)
      }
    })
    void s.start()
    return () => {
      unsub()
      s.dispose()
    }
  }, [athleteId, cycle])

  const snap = view?.snapshot
  const last = snap?.lastRep

  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] bg-court ring-1 ring-line/70">
      <div className="relative">
        <canvas ref={canvas} className="block aspect-video w-full" aria-label="Simulated athlete doing push-ups" />
        <span className="absolute top-3 left-3 rounded-full bg-ink/80 px-2.5 py-1 text-[11px] font-semibold text-jersey">
          Simulated athlete · real detector
        </span>
        <div className="absolute top-2 right-4 text-right">
          <div key={pop} className={cx('font-display leading-none font-black tabular text-chalk', compact ? 'text-6xl' : 'text-7xl', pop > 0 && 'rep-pop')}>
            {snap?.validReps ?? 0}
          </div>
          <div className="text-xs text-mist">valid reps</div>
        </div>
        <div className="absolute inset-x-3 bottom-3 flex items-center justify-between gap-2">
          <span
            className={cx(
              'rounded-full px-3 py-1 text-sm font-semibold',
              snap?.feedback.tone === 'good' && 'bg-go/90 text-ink',
              snap?.feedback.tone === 'warn' && 'bg-jersey text-ink',
              snap?.feedback.tone === 'bad' && 'bg-flag text-ink',
              (!snap || snap.feedback.tone === 'neutral') && 'bg-ink/80 text-chalk',
            )}
            aria-live="polite"
          >
            {snap?.feedback.message ?? 'Getting ready'}
          </span>
          {last && (
            <span className="rounded-full bg-ink/80 px-3 py-1 text-sm tabular text-chalk">
              {last.valid ? `Rep ${last.index}: form ${Math.round(last.formScore)}` : `Rep ${last.index}: didn't count`}
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 p-3" role="radiogroup" aria-label="Simulated athlete">
        {ATHLETES.map((a) => (
          <button
            key={a.id}
            role="radio"
            aria-checked={athleteId === a.id}
            onClick={() => setAthleteId(a.id)}
            title={a.description}
            className={cx(
              'h-9 rounded-full px-3.5 text-sm transition-colors',
              athleteId === a.id ? 'bg-chalk font-semibold text-ink' : 'bg-court-hi text-mist hover:text-chalk',
            )}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  )
}
