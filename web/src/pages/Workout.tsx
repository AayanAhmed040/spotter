import {
  AlertTriangle,
  Camera,
  Footprints,
  FlipHorizontal2,
  Layers,
  Lightbulb,
  Pause,
  Play,
  Ruler,
  ShieldCheck,
  Square,
  Users,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { LogoMark } from '../components/Logo'
import { Badge, Button, cx, ErrorNote, Meter, Segmented } from '../components/ui'
import { VideoSlot } from '../components/VideoSlot'
import { getExercise, type ExerciseDefinition, type SessionSummary } from '../exercises'
import type { TipIcon } from '../exercises/definition'
import { EXERCISE_IDS, EXERCISE_META } from '../exercises/meta'
import { CameraError, type CameraFacing } from '../exercises/shared/mediapipe'
import { WorkoutSession, type SessionResult, type SessionView } from '../exercises/shared/session'
import type { ExerciseId } from '../exercises/shared/types'
import { clock, confidenceLabel, holdTime } from '../lib/format'
import { useSaveWorkout, type NewWorkout } from '../lib/queries'
import type { Workout as SavedWorkout } from '../lib/types'

interface Setup {
  exercise: ExerciseId
  facing: CameraFacing
  /** Reps, or seconds for hold exercises. */
  target: number
}

/** Below this mean tracking confidence a set is too unreliable to post to groups. */
const MIN_POSTABLE_CONFIDENCE = 0.45

export default function Workout() {
  const [params] = useSearchParams()
  const initial = getExercise(params.get('exercise'))
  const [stage, setStage] = useState<'setup' | 'live' | 'results'>('setup')
  const [setup, setSetup] = useState<Setup>({ exercise: initial.id, facing: 'user', target: initial.defaultTarget })
  const [result, setResult] = useState<SessionResult | null>(null)
  const def = getExercise(setup.exercise)

  if (stage === 'live')
    return (
      <LiveSession
        def={def}
        setup={setup}
        onFinish={(r) => {
          setResult(r)
          setStage('results')
        }}
        onCancel={() => setStage('setup')}
      />
    )
  if (stage === 'results' && result) return <Results def={def} setup={setup} result={result} onAgain={() => setStage('setup')} />
  return <SetupScreen setup={setup} onChange={setSetup} onStart={() => setStage('live')} />
}

// ---------------- setup ----------------

const TIP_ICONS: Record<TipIcon, typeof Camera> = {
  side: Camera,
  frame: Ruler,
  light: Lightbulb,
  privacy: ShieldCheck,
  floor: Layers,
  feet: Footprints,
}

/** Can this browser run a tracked workout at all? */
function unsupportedReason(): string | null {
  if (!window.isSecureContext) return 'The camera only works over a secure connection. Open Striqs with https:// (or on localhost).'
  if (!navigator.mediaDevices?.getUserMedia) return "This browser can't access the camera. Try the latest Chrome, Safari or Firefox."
  if (typeof WebAssembly === 'undefined') return "This browser can't run the pose-tracking model. Try the latest Chrome, Safari or Firefox."
  return null
}

function targetLabel(def: ExerciseDefinition, t: number): string {
  return def.kind === 'hold' ? clock(t * 1000) : `${t}`
}

function SetupScreen({ setup, onChange, onStart }: { setup: Setup; onChange: (s: Setup) => void; onStart: () => void }) {
  const def = getExercise(setup.exercise)
  const unsupported = useMemo(unsupportedReason, [])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-[40px] leading-none font-semibold tracking-[-0.03em]">Start a workout</h1>
        <p className="mt-2 text-mist">Pick an exercise. Form counts for 70% of your score, so take your time.</p>
      </div>

      <div role="radiogroup" aria-label="Exercise" className="grid grid-cols-3 gap-2">
        {EXERCISE_IDS.map((id) => {
          const m = EXERCISE_META[id]
          const on = setup.exercise === id
          return (
            <button
              key={id}
              role="radio"
              aria-checked={on}
              onClick={() => {
                const next = getExercise(id)
                onChange({ ...setup, exercise: id, target: next.defaultTarget })
              }}
              className={cx(
                'rounded-2xl p-3 text-left transition-colors',
                on ? 'bg-accent text-ink' : 'bg-court text-chalk hover:bg-court-hi',
              )}
            >
              <span className="block font-display text-lg leading-tight font-semibold">{m.name}</span>
              <span className={cx('mt-1 hidden text-sm sm:block', on ? 'text-ink/70' : 'text-mist')}>{m.measures}</span>
              <span className={cx('mt-1 block text-xs sm:hidden', on ? 'text-ink/70' : 'text-mist')}>
                {m.kind === 'hold' ? 'Timed hold' : 'Rep counter'}
              </span>
            </button>
          )
        })}
      </div>

      <div className="grid gap-5 md:grid-cols-2 md:items-start">
        <div className="space-y-5">
          <div>
            <p className="text-[15px]">{def.camera.summary}</p>
            <ul className="mt-3 space-y-2.5">
              {def.camera.tips.map((t) => {
                const Icon = TIP_ICONS[t.icon]
                return (
                  <li key={t.title} className="flex gap-3">
                    <Icon className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
                    <div>
                      <p className="font-semibold">{t.title}</p>
                      <p className="text-sm text-mist">{t.body}</p>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-mist">{def.kind === 'hold' ? 'Target hold' : 'Target reps'}</span>
            <Segmented
              label={def.kind === 'hold' ? 'Target hold' : 'Target reps'}
              value={String(setup.target)}
              onChange={(t) => onChange({ ...setup, target: Number(t) })}
              options={def.targets.map((t) => ({ value: String(t), label: targetLabel(def, t) }))}
            />
          </div>

          {unsupported && (
            <div role="alert" className="flex gap-3 rounded-2xl border border-warn/40 bg-warn/10 p-3 text-sm">
              <AlertTriangle className="size-5 shrink-0 text-warn" aria-hidden />
              {unsupported}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button size="lg" onClick={onStart} disabled={Boolean(unsupported)}>
              <Camera className="size-5" aria-hidden /> Start camera
            </Button>
            <Button variant="ghost" onClick={() => onChange({ ...setup, facing: setup.facing === 'user' ? 'environment' : 'user' })}>
              <FlipHorizontal2 className="size-4" aria-hidden />
              {setup.facing === 'user' ? 'Front camera' : 'Back camera'}
            </Button>
          </div>
        </div>
        <VideoSlot src={def.setupVideo} label={`How to set up for ${def.name.toLowerCase()}`} />
      </div>
    </div>
  )
}

// ---------------- live ----------------

function LiveSession({
  def,
  setup,
  onFinish,
  onCancel,
}: {
  def: ExerciseDefinition
  setup: Setup
  onFinish: (r: SessionResult) => void
  onCancel: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const session = useRef<WorkoutSession | null>(null)
  const [view, setView] = useState<SessionView | null>(null)
  const [aspect, setAspect] = useState(16 / 9)
  const [pop, setPop] = useState(0)
  const mirrored = setup.facing === 'user'
  const isHold = def.kind === 'hold'

  useEffect(() => {
    const s = new WorkoutSession(def.createTracker(), setup.facing, video.current!, canvas.current!)
    session.current = s
    let lastValid = 0
    const unsub = s.subscribe((v) => {
      setView(v)
      const valid = v.live.validReps ?? 0
      if (valid !== lastValid) {
        lastValid = valid
        setPop((p) => p + 1)
        navigator.vibrate?.(30)
      }
      if (v.status === 'running' && canvas.current?.height) setAspect(canvas.current.width / canvas.current.height)
    })
    void s.start()
    // Keep the screen awake during a set where supported.
    let wake: WakeLockSentinel | null = null
    navigator.wakeLock
      ?.request('screen')
      .then((w) => (wake = w))
      .catch(() => {})
    return () => {
      unsub()
      s.dispose()
      void wake?.release()
    }
  }, [def, setup.facing])

  const live = view?.live
  const status = view?.status ?? 'loading'
  const error = view?.error
  const tone = live?.feedback.tone ?? 'neutral'
  const quality = live?.trackingQuality ?? 0
  const tracking = status === 'running' || status === 'paused'
  const recorded = isHold ? (live?.holdMs ?? 0) > 0 : (live?.attemptedReps ?? 0) > 0

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-semibold tracking-tight">{def.name}</h1>
        <span className="text-sm text-mist">
          Target {isHold ? clock(setup.target * 1000) : `${setup.target} ${def.plural}`}
        </span>
      </div>

      <div className="relative w-full overflow-hidden rounded-[var(--radius-card)] bg-black" style={{ aspectRatio: aspect }}>
        <video ref={video} className={cx('absolute inset-0 size-full object-contain', mirrored && '-scale-x-100')} playsInline muted />
        <canvas ref={canvas} className={cx('absolute inset-0 size-full object-contain', mirrored && '-scale-x-100')} />

        {status === 'loading' && (
          <div className="absolute inset-0 grid place-items-center bg-ink/85 text-center">
            <div>
              <LogoMark className="mx-auto h-8 w-auto animate-pulse text-accent" />
              <p className="mt-3 text-sm text-mist">Loading the pose model and camera…</p>
            </div>
          </div>
        )}

        {status === 'error' && error && (
          <div className="absolute inset-0 grid place-items-center bg-ink/95 p-6 text-center">
            <div className="max-w-sm">
              <p className="font-semibold">Couldn't track your workout</p>
              <p className="mt-2 text-sm text-mist">{error.message}</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {recorded ? (
                  <Button size="sm" onClick={() => session.current && onFinish(session.current.finish())}>
                    Finish with what was tracked
                  </Button>
                ) : (
                  !(error instanceof CameraError && error.kind === 'insecure') && (
                    <Button size="sm" onClick={() => void session.current?.start()}>
                      Try again
                    </Button>
                  )
                )}
                <Button size="sm" variant="secondary" onClick={onCancel}>
                  Back to setup
                </Button>
              </div>
            </div>
          </div>
        )}

        {tracking && live && (
          <>
            <div className="absolute top-3 left-3 flex flex-col gap-1.5">
              <span className="rounded-full bg-ink/80 px-3 py-1 font-display text-lg font-semibold tabular">{clock(view.activeMs)}</span>
              <span className="flex items-center gap-1.5 rounded-full bg-ink/80 px-2.5 py-1 text-[11px] text-mist" title="How confident the pose tracking is">
                <span className={cx('size-2 rounded-full', quality >= 0.75 ? 'bg-go' : quality >= 0.5 ? 'bg-warn' : 'bg-flag')} />
                Tracking {Math.round(quality * 100)}%
              </span>
            </div>
            <div className="absolute top-2 right-4 text-right">
              {isHold ? (
                <>
                  <div className={cx('font-display text-6xl leading-none font-semibold tabular drop-shadow-lg sm:text-[80px]', live.holding ? 'text-chalk' : 'text-chalk/50')}>
                    {holdTime(live.holdMs)}
                  </div>
                  <div className={cx('mt-1 text-xs font-semibold', live.holding ? 'text-go' : 'text-warn')}>
                    {live.holding ? 'Timer running' : live.phase === 'active' ? 'Hold steady…' : 'Timer paused'}
                  </div>
                </>
              ) : (
                <>
                  <div key={pop} className={cx('font-display text-7xl leading-[0.85] font-semibold tabular drop-shadow-lg sm:text-[96px]', pop > 0 && 'rep-pop')}>
                    {live.validReps ?? 0}
                  </div>
                  <div className="text-xs text-chalk/80">of {setup.target}</div>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {tracking && live && (
        <>
          {/* Coaching cue sits below the video so it never covers the body being tracked. */}
          <div
            aria-live="polite"
            className={cx(
              'rounded-2xl px-4 py-3 text-center text-lg font-semibold transition-colors',
              tone === 'good' && 'bg-go text-ink',
              tone === 'warn' && 'bg-warn text-ink',
              tone === 'bad' && 'bg-flag text-ink',
              tone === 'neutral' && 'bg-court text-chalk',
            )}
          >
            {status === 'paused' ? 'Paused — tap Resume, then get back into position' : live.feedback.message}
          </div>
          {live.phase !== 'active' && status === 'running' && <p className="text-center text-sm text-mist">{def.startCue}</p>}
          {view?.environment === 'dark' && (
            <p role="alert" className="flex items-center justify-center gap-2 text-sm text-warn">
              <Lightbulb className="size-4" aria-hidden /> It's quite dark — turn on a light facing you for better tracking.
            </p>
          )}
          {status === 'running' && live.phase === 'active' && quality < 0.4 && (
            <p role="alert" className="flex items-center justify-center gap-2 text-sm text-warn">
              <AlertTriangle className="size-4" aria-hidden /> Tracking is unreliable — move the camera so your whole body is in view.
            </p>
          )}
          <dl className="grid grid-cols-3 gap-2 text-center">
            {isHold ? (
              <>
                <LiveStat label="form now" value={live.liveFormScore == null ? '–' : String(Math.round(live.liveFormScore))} />
                <LiveStat label="current hold" value={holdTime(live.currentHoldMs)} />
                <LiveStat label={live.readouts[0]?.label ?? 'body line'} value={live.readouts[0]?.value ?? '–'} />
              </>
            ) : (
              <>
                <LiveStat label={live.readouts[0]?.label ?? 'angle'} value={live.readouts[0]?.value ?? '–'} />
                <LiveStat
                  label="last rep form"
                  value={live.lastRep ? (live.lastRep.valid ? String(Math.round(live.lastRep.formScore)) : '✕') : '–'}
                />
                <LiveStat label="didn't count" value={String((live.attemptedReps ?? 0) - (live.validReps ?? 0))} />
              </>
            )}
          </dl>
        </>
      )}

      <div className="flex items-center gap-2">
        {status === 'paused' ? (
          <Button variant="secondary" onClick={() => session.current?.resume()}>
            <Play className="size-4" aria-hidden /> Resume
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => session.current?.pause()} disabled={status !== 'running'}>
            <Pause className="size-4" aria-hidden /> Pause
          </Button>
        )}
        <Button className="flex-1" onClick={() => session.current && onFinish(session.current.finish())} disabled={!tracking}>
          <Square className="size-4 fill-current" aria-hidden /> Finish
        </Button>
        <Button variant="ghost" aria-label="Cancel workout" onClick={onCancel}>
          <X className="size-5" aria-hidden />
        </Button>
      </div>
      {status === 'running' && <p className="text-center text-xs text-dim">Pose tracking at {view?.fps ?? 0} fps on this device.</p>}
    </div>
  )
}

function LiveStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-court px-2 py-2.5">
      <dd className="font-display text-2xl leading-none font-semibold tabular">{value}</dd>
      <dt className="mt-1 text-[11px] text-mist">{label}</dt>
    </div>
  )
}

// ---------------- results ----------------

function Results({ def, setup, result, onAgain }: { def: ExerciseDefinition; setup: Setup; result: SessionResult; onAgain: () => void }) {
  const navigate = useNavigate()
  const save = useSaveWorkout()
  const [visibility, setVisibility] = useState<'groups' | 'private'>('groups')
  const [note, setNote] = useState('')
  const [saved, setSaved] = useState<SavedWorkout | null>(null)
  const preview: SessionSummary = useMemo(() => def.score(result.recording, setup.target), [def, result, setup.target])
  const reasons = useMemo(() => def.explain(preview, result.recording), [def, preview, result])
  const details = useMemo(() => def.details(result.recording), [def, result])
  const isHold = preview.kind === 'hold'
  const hasData = preview.kind === 'hold' ? result.recording.kind === 'hold' && result.recording.windows.length > 0 : preview.attemptedReps > 0
  const lowConfidence = hasData && preview.confidence < MIN_POSTABLE_CONFIDENCE
  const conf = confidenceLabel(preview.confidence)
  const shownFinal = saved?.finalScore ?? preview.finalScore
  const shownForm = saved?.formScore ?? preview.formScore
  const effectiveVisibility = lowConfidence ? 'private' : visibility

  const submit = () => {
    const base = {
      exercise: def.id,
      source: 'camera' as const,
      visibility: effectiveVisibility,
      startedAt: result.startedAt,
      durationMs: result.durationMs,
      note: note.trim() || undefined,
    }
    const body: NewWorkout =
      result.recording.kind === 'hold'
        ? { ...base, targetHoldMs: setup.target * 1000, holdWindows: result.recording.windows }
        : { ...base, targetReps: setup.target, reps: result.recording.reps }
    save.mutate(body, { onSuccess: setSaved })
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[var(--radius-card)] bg-court p-5">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-3xl font-semibold tracking-tight">{def.name} done</h1>
        </div>
        <div className="mt-4 flex items-end gap-6">
          <div>
            <div className="font-display text-[104px] leading-[0.8] font-semibold text-accent tabular">{Math.round(shownFinal)}</div>
            <div className="mt-3 text-sm text-mist">final score</div>
          </div>
          <dl className="mb-1 space-y-2 text-sm">
            <div>
              <dt className="text-mist">Form (70%)</dt>
              <dd className="font-display text-3xl leading-none font-semibold tabular">{Math.round(shownForm)}</dd>
            </div>
            <div>
              <dt className="text-mist">{isHold ? 'Time held (30%)' : 'Reps (30%)'}</dt>
              <dd className="font-display text-3xl leading-none font-semibold tabular">
                {preview.kind === 'hold' ? holdTime(saved?.holdMs ?? preview.holdMs) : (saved?.validReps ?? preview.validReps)}
                <span className="font-sans text-sm font-normal text-mist">
                  {' '}
                  / {isHold ? clock(setup.target * 1000) : setup.target}
                </span>
              </dd>
            </div>
            {preview.kind === 'hold' && preview.longestHoldMs < preview.holdMs - 999 && (
              <div>
                <dt className="text-mist">Longest unbroken hold</dt>
                <dd className="font-display text-xl leading-none font-semibold tabular">{holdTime(preview.longestHoldMs)}</dd>
              </div>
            )}
          </dl>
        </div>
        <p className="mt-4 text-xs text-dim">
          Score = 0.7 × form + 0.3 × min({isHold ? 'time held' : 'reps'} ÷ target, 1) × 100. {clock(result.durationMs)} on camera.{' '}
          <span className={cx(conf.tone === 'good' ? 'text-go' : conf.tone === 'warn' ? 'text-warn' : 'text-flag')}>{conf.label}.</span>
        </p>
      </section>

      {lowConfidence && (
        <div role="alert" className="flex gap-3 rounded-2xl border border-warn/40 bg-warn/10 p-4 text-sm">
          <AlertTriangle className="size-5 shrink-0 text-warn" aria-hidden />
          <p>
            The camera couldn't see you clearly for most of this set, so these numbers may be off. You can save it for
            yourself, but it won't be posted to your groups. Check the lighting and that your whole body is in frame.
          </p>
        </div>
      )}

      {hasData && (
        <section>
          <h2 className="mb-3 font-display text-2xl font-semibold tracking-tight">Why you got this score</h2>
          <div className="grid gap-3 rounded-[var(--radius-card)] bg-court p-4 sm:grid-cols-2">
            {def.components.map((c) => {
              const v = preview.componentAverages[c.key] ?? 0
              return (
                <div key={c.key}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span>
                      {c.label} <span className="text-dim">{Math.round(c.weight * 100)}% of form</span>
                    </span>
                    <span className="tabular">{Math.round(v)}</span>
                  </div>
                  <Meter value={v} tone={v >= 80 ? 'go' : v >= 55 ? 'warn' : 'flag'} />
                </div>
              )
            })}
          </div>
        </section>
      )}

      <ul className="space-y-2">
        {reasons.map((r) => (
          <li key={r} className="flex gap-2 text-[15px]">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
            {r}
          </li>
        ))}
      </ul>

      {details.length > 0 && (
        <details className="rounded-[var(--radius-card)] bg-court p-4">
          <summary className="cursor-pointer font-semibold">
            {isHold ? `Every hold (${details.length})` : `Every rep (${details.length})`}
          </summary>
          <ol className="mt-3 divide-y divide-line/50 text-sm">
            {details.map((d) => (
              <li key={d.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2">
                <span className="w-16 text-dim">{d.title}</span>
                <strong className={cx('tabular', !d.counted && 'text-flag')}>{d.value}</strong>
                <span className={cx('text-mist', !d.counted && 'text-flag/80')}>{d.note}</span>
              </li>
            ))}
          </ol>
        </details>
      )}

      <p className="text-xs text-dim">
        Feedback is an estimate from 2D pose tracking and can be thrown off by camera angle, clothing or lighting. It
        isn't medical or professional coaching advice.
      </p>

      {saved ? (
        <div className="rounded-[var(--radius-card)] bg-go/10 p-5 ring-1 ring-go/40">
          <p className="font-semibold text-go">{saved.visibility === 'groups' ? 'Posted to your groups.' : 'Saved privately.'}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => navigate('/feed')}>See the feed</Button>
            <Button variant="secondary" onClick={onAgain}>
              Do another set
            </Button>
          </div>
        </div>
      ) : hasData ? (
        <section className="space-y-3 rounded-[var(--radius-card)] bg-court p-4">
          <label className="block">
            <span className="text-sm text-mist">Add a note (optional)</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={280}
              placeholder="Lunch break set before the lecture"
              className="mt-1 h-11 w-full rounded-xl border border-line bg-ink px-3 text-chalk placeholder:text-dim focus:border-accent focus:outline-none"
            />
          </label>
          {!lowConfidence && (
            <Segmented
              label="Who can see this"
              value={visibility}
              onChange={setVisibility}
              options={[
                { value: 'groups', label: 'My groups' },
                { value: 'private', label: 'Only me' },
              ]}
            />
          )}
          {save.isError && <ErrorNote error={save.error} />}
          <div className="flex flex-wrap gap-2">
            <Button size="lg" onClick={submit} loading={save.isPending}>
              <Users className="size-5" aria-hidden /> {effectiveVisibility === 'groups' ? 'Post to my groups' : 'Save privately'}
            </Button>
            <Button size="lg" variant="ghost" onClick={onAgain}>
              Discard
            </Button>
          </div>
        </section>
      ) : (
        <section className="space-y-3 rounded-[var(--radius-card)] bg-court p-4">
          <p className="text-[15px]">
            Nothing was recorded, so there's nothing to save. {def.startCue} Check the setup tips and try again.
          </p>
          <Badge>Tip: watch the coaching bar under the video — it says what the camera needs.</Badge>
          <div>
            <Button onClick={onAgain}>Back to setup</Button>
          </div>
        </section>
      )}
    </div>
  )
}
