import { Camera, FlipHorizontal2, Lightbulb, Pause, Play, Ruler, ShieldCheck, Square, Users, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PushupGlyph } from '../components/AppShell'
import { Badge, Button, cx, ErrorNote, Meter, Segmented } from '../components/ui'
import { clock, confidenceLabel } from '../lib/format'
import { useSaveWorkout } from '../lib/queries'
import type { Workout as SavedWorkout } from '../lib/types'
import { CameraError, type CameraFacing } from '../pose/mediapipe'
import { explainSession, scoreSession, SCORING } from '../pose/scoring'
import { WorkoutSession, type SessionResult, type SessionView } from '../pose/session'
import { ATHLETES } from '../pose/simulator'

type Mode = 'camera' | 'demo'
interface Setup {
  mode: Mode
  facing: CameraFacing
  athleteId: string
  target: number
}

export default function Workout() {
  const [stage, setStage] = useState<'setup' | 'live' | 'results'>('setup')
  const [setup, setSetup] = useState<Setup>({ mode: 'camera', facing: 'user', athleteId: 'solid', target: SCORING.defaultTargetReps })
  const [result, setResult] = useState<SessionResult | null>(null)

  if (stage === 'live')
    return (
      <LiveSession
        setup={setup}
        onFinish={(r) => {
          setResult(r)
          setStage('results')
        }}
        onCancel={() => setStage('setup')}
        onSwitchToDemo={() => setSetup((s) => ({ ...s, mode: 'demo' }))}
      />
    )
  if (stage === 'results' && result)
    return <Results setup={setup} result={result} onAgain={() => setStage('setup')} />
  return <SetupScreen setup={setup} onChange={setSetup} onStart={() => setStage('live')} />
}

// ---------------- setup ----------------

function SetupScreen({ setup, onChange, onStart }: { setup: Setup; onChange: (s: Setup) => void; onStart: () => void }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-5xl leading-none font-black">Push-up set</h1>
        <p className="mt-2 text-mist">Do as many good reps as you can. Stop whenever you like — form counts more than volume.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="Mode"
          value={setup.mode}
          onChange={(mode) => onChange({ ...setup, mode })}
          options={[
            { value: 'camera', label: 'My camera' },
            { value: 'demo', label: 'Demo athlete' },
          ]}
        />
        <Segmented
          label="Target reps"
          value={String(setup.target) as '10' | '20' | '30'}
          onChange={(t) => onChange({ ...setup, target: Number(t) })}
          options={[
            { value: '10', label: '10' },
            { value: '20', label: '20' },
            { value: '30', label: '30' },
          ]}
        />
      </div>

      {setup.mode === 'camera' ? (
        <>
          <ul className="grid gap-3 sm:grid-cols-2">
            <Tip icon={Camera} title="Side-on to the camera">
              The AI measures your elbow and hip angles from the side.
            </Tip>
            <Tip icon={Ruler} title="Head to heels in frame">
              Prop your phone on the floor about 2 m away, in landscape.
            </Tip>
            <Tip icon={Lightbulb} title="Light in front of you">
              A bright window behind you turns you into a silhouette.
            </Tip>
            <Tip icon={ShieldCheck} title="Video stays on this device">
              Only the rep measurements are saved — never the footage.
            </Tip>
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="lg" onClick={onStart}>
              <PushupGlyph className="size-6" /> Start camera
            </Button>
            <Button
              variant="ghost"
              onClick={() => onChange({ ...setup, facing: setup.facing === 'user' ? 'environment' : 'user' })}
            >
              <FlipHorizontal2 className="size-4" aria-hidden />
              {setup.facing === 'user' ? 'Front camera' : 'Back camera'}
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="rounded-[var(--radius-card)] border border-jersey/40 bg-jersey/5 p-4">
            <Badge tone="sim">Simulation</Badge>
            <p className="mt-2 text-[15px]">
              No camera needed. A simulated athlete performs push-ups and the <strong>real</strong> detector and scorer
              analyse every frame. Demo sets are labelled "Simulated" and never count toward leaderboards or challenges.
            </p>
          </div>
          <div role="radiogroup" aria-label="Simulated athlete" className="grid gap-2 sm:grid-cols-3">
            {ATHLETES.map((a) => (
              <button
                key={a.id}
                role="radio"
                aria-checked={setup.athleteId === a.id}
                onClick={() => onChange({ ...setup, athleteId: a.id })}
                className={cx(
                  'rounded-2xl p-3 text-left transition-colors',
                  setup.athleteId === a.id ? 'bg-chalk text-ink' : 'bg-court hover:bg-court-hi',
                )}
              >
                <span className="font-semibold">{a.label}</span>
                <span className={cx('mt-0.5 block text-sm', setup.athleteId === a.id ? 'text-ink/70' : 'text-mist')}>
                  {a.description}
                </span>
              </button>
            ))}
          </div>
          <Button size="lg" onClick={onStart}>
            <Play className="size-5" aria-hidden /> Start demo set
          </Button>
        </>
      )}
    </div>
  )
}

function Tip({ icon: Icon, title, children }: { icon: typeof Camera; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 rounded-2xl bg-court p-3">
      <Icon className="mt-0.5 size-5 shrink-0 text-jersey" aria-hidden />
      <div>
        <p className="font-semibold">{title}</p>
        <p className="text-sm text-mist">{children}</p>
      </div>
    </li>
  )
}

// ---------------- live ----------------

function LiveSession({
  setup,
  onFinish,
  onCancel,
  onSwitchToDemo,
}: {
  setup: Setup
  onFinish: (r: SessionResult) => void
  onCancel: () => void
  onSwitchToDemo: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const session = useRef<WorkoutSession | null>(null)
  const [view, setView] = useState<SessionView | null>(null)
  const [aspect, setAspect] = useState(16 / 9)
  const [pop, setPop] = useState(0)
  const isDemo = setup.mode === 'demo'
  const mirrored = !isDemo && setup.facing === 'user'

  useEffect(() => {
    const athlete = ATHLETES.find((a) => a.id === setup.athleteId)!
    const s = new WorkoutSession(
      isDemo ? { kind: 'demo', athlete } : { kind: 'camera', facing: setup.facing },
      video.current,
      canvas.current!,
    )
    session.current = s
    let lastValid = 0
    const unsub = s.subscribe((v) => {
      setView(v)
      if (v.snapshot.validReps !== lastValid) {
        lastValid = v.snapshot.validReps
        setPop((p) => p + 1)
        navigator.vibrate?.(30)
      }
      if (v.status === 'running' && canvas.current) setAspect(canvas.current.width / canvas.current.height)
    })
    void s.start()
    // Keep the screen awake during a set where supported.
    let wake: WakeLockSentinel | null = null
    navigator.wakeLock?.request('screen').then((w) => (wake = w)).catch(() => {})
    return () => {
      unsub()
      s.dispose()
      void wake?.release()
    }
  }, [isDemo, setup.athleteId, setup.facing])

  const snap = view?.snapshot
  const status = view?.status ?? 'loading'
  const error = view?.error
  const tone = snap?.feedback.tone ?? 'neutral'
  const quality = snap?.trackingQuality ?? 0

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-black">{isDemo ? 'Demo set' : 'Live set'}</h1>
        {isDemo && <Badge tone="sim">Simulated athlete</Badge>}
      </div>

      <div className="relative w-full overflow-hidden rounded-[var(--radius-card)] bg-black" style={{ aspectRatio: aspect }}>
        <video ref={video} className={cx('absolute inset-0 size-full object-contain', mirrored && '-scale-x-100', isDemo && 'hidden')} playsInline muted />
        <canvas ref={canvas} className={cx('absolute inset-0 size-full object-contain', mirrored && '-scale-x-100')} />

        {status === 'loading' && (
          <div className="absolute inset-0 grid place-items-center bg-ink/80 text-center">
            <div>
              <div className="mx-auto size-10 animate-spin rounded-full border-4 border-line border-t-jersey" />
              <p className="mt-3 text-sm text-mist">{isDemo ? 'Starting the simulation…' : 'Loading the pose model and camera…'}</p>
            </div>
          </div>
        )}

        {status === 'error' && error && (
          <div className="absolute inset-0 grid place-items-center bg-ink/95 p-6 text-center">
            <div className="max-w-sm">
              <p className="font-semibold">Couldn't start tracking</p>
              <p className="mt-2 text-sm text-mist">{error.message}</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Button size="sm" onClick={onSwitchToDemo}>
                  Use demo athlete instead
                </Button>
                {!(error instanceof CameraError && error.kind === 'insecure') && (
                  <Button size="sm" variant="secondary" onClick={() => void session.current?.start()}>
                    Try again
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {(status === 'running' || status === 'paused') && snap && (
          <>
            <div className="absolute top-3 left-3 flex flex-col gap-1.5">
              <span className="rounded-full bg-ink/80 px-3 py-1 font-display text-xl font-extrabold tabular">{clock(view.activeMs)}</span>
              <span className="flex items-center gap-1.5 rounded-full bg-ink/80 px-2.5 py-1 text-[11px] text-mist" title="How confident the pose tracking is">
                <span className={cx('size-2 rounded-full', quality >= 0.75 ? 'bg-go' : quality >= 0.5 ? 'bg-jersey' : 'bg-flag')} />
                Tracking {Math.round(quality * 100)}%
              </span>
            </div>
            <div className="absolute top-2 right-4 text-right">
              <div key={pop} className={cx('font-display text-7xl leading-[0.85] font-black tabular drop-shadow-lg sm:text-[96px]', pop > 0 && 'rep-pop')}>
                {snap.validReps}
              </div>
              <div className="text-xs text-chalk/80">
                of {setup.target}
              </div>
            </div>
          </>
        )}
      </div>

      {(status === 'running' || status === 'paused') && snap && (
        <>
          {/* Coaching cue sits below the video so it never covers the body being tracked. */}
          <div
            aria-live="polite"
            className={cx(
              'rounded-2xl px-4 py-3 text-center text-lg font-semibold transition-colors',
              tone === 'good' && 'bg-go text-ink',
              tone === 'warn' && 'bg-jersey text-ink',
              tone === 'bad' && 'bg-flag text-ink',
              tone === 'neutral' && 'bg-court text-chalk',
            )}
          >
            {status === 'paused' ? 'Paused — tap Resume and get back into your plank' : snap.feedback.message}
          </div>
          <dl className="grid grid-cols-3 gap-2 text-center">
            <LiveStat label="elbow angle" value={snap.elbowAngle === null ? '–' : `${snap.elbowAngle}°`} />
            <LiveStat
              label="last rep form"
              value={snap.lastRep ? (snap.lastRep.valid ? String(Math.round(snap.lastRep.formScore)) : '✕') : '–'}
            />
            <LiveStat label="didn't count" value={String(snap.attemptedReps - snap.validReps)} />
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
        <Button className="flex-1" onClick={() => session.current && onFinish(session.current.finish())} disabled={status !== 'running' && status !== 'paused'}>
          <Square className="size-4 fill-current" aria-hidden /> Finish set
        </Button>
        <Button variant="ghost" aria-label="Cancel set" onClick={onCancel}>
          <X className="size-5" aria-hidden />
        </Button>
      </div>
      {!isDemo && status === 'running' && (
        <p className="text-center text-xs text-dim">
          Counts start once you hold a high plank side-on. Pose tracking at {view?.fps ?? 0} fps on this device.
        </p>
      )}
    </div>
  )
}

function LiveStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-court px-2 py-2.5">
      <dd className="font-display text-3xl leading-none font-extrabold tabular">{value}</dd>
      <dt className="mt-1 text-[11px] text-mist">{label}</dt>
    </div>
  )
}

// ---------------- results ----------------

function Results({ setup, result, onAgain }: { setup: Setup; result: SessionResult; onAgain: () => void }) {
  const navigate = useNavigate()
  const save = useSaveWorkout()
  const [visibility, setVisibility] = useState<'groups' | 'private'>('groups')
  const [note, setNote] = useState('')
  const [saved, setSaved] = useState<SavedWorkout | null>(null)
  const preview = scoreSession(result.reps, setup.target)
  const s = saved
    ? { ...preview, finalScore: saved.finalScore, formScore: saved.formScore, repScore: saved.repScore, validReps: saved.validReps }
    : preview
  const reasons = explainSession(preview, result.reps)
  const conf = confidenceLabel(preview.confidence)
  const isDemo = setup.mode === 'demo'

  const submit = () =>
    save.mutate(
      {
        source: isDemo ? 'demo' : 'camera',
        visibility,
        startedAt: result.startedAt,
        durationMs: result.durationMs,
        targetReps: setup.target,
        reps: result.reps.map(({ components: _c, formScore: _f, ...m }) => m),
        note: note.trim() || undefined,
      },
      { onSuccess: setSaved },
    )

  return (
    <div className="space-y-6">
      <section className="rounded-[var(--radius-card)] bg-court p-5">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-3xl font-black">Set complete</h1>
          {isDemo && <Badge tone="sim">Simulated</Badge>}
        </div>
        <div className="mt-4 flex items-end gap-6">
          <div>
            <div className="font-display text-[112px] leading-[0.8] font-black text-jersey tabular">{Math.round(s.finalScore)}</div>
            <div className="mt-2 text-sm text-mist">final score</div>
          </div>
          <dl className="mb-1 space-y-2 text-sm">
            <div>
              <dt className="text-mist">Form (70%)</dt>
              <dd className="font-display text-3xl leading-none font-extrabold tabular">{Math.round(s.formScore)}</dd>
            </div>
            <div>
              <dt className="text-mist">Reps (30%)</dt>
              <dd className="font-display text-3xl leading-none font-extrabold tabular">
                {s.validReps}
                <span className="font-sans text-sm font-normal text-mist"> / {setup.target}</span>
              </dd>
            </div>
          </dl>
        </div>
        <p className="mt-4 text-xs text-dim">
          Score = 0.7 × form + 0.3 × min(reps ÷ target, 1) × 100. {clock(result.durationMs)} active time.{' '}
          <span className={cx(conf.tone === 'good' ? 'text-go' : conf.tone === 'warn' ? 'text-jersey' : 'text-flag')}>{conf.label}.</span>
        </p>
      </section>

      <section>
        <h2 className="mb-3 font-display text-2xl font-extrabold">Why you got this score</h2>
        <div className="grid gap-3 rounded-[var(--radius-card)] bg-court p-4 sm:grid-cols-2">
          {(
            [
              ['Depth', preview.componentAverages.depth, '40% of form'],
              ['Body line', preview.componentAverages.alignment, '35%'],
              ['Lockout', preview.componentAverages.lockout, '15%'],
              ['Control', preview.componentAverages.control, '10%'],
            ] as const
          ).map(([label, v, weight]) => (
            <div key={label}>
              <div className="mb-1 flex justify-between text-sm">
                <span>
                  {label} <span className="text-dim">· {weight}</span>
                </span>
                <span className="tabular">{Math.round(v)}</span>
              </div>
              <Meter value={v} tone={v >= 80 ? 'go' : v >= 55 ? 'jersey' : 'flag'} />
            </div>
          ))}
        </div>
        <ul className="mt-3 space-y-2">
          {reasons.map((r) => (
            <li key={r} className="flex gap-2 text-[15px]">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-jersey" aria-hidden />
              {r}
            </li>
          ))}
        </ul>
      </section>

      {result.reps.length > 0 && (
        <details className="rounded-[var(--radius-card)] bg-court p-4">
          <summary className="cursor-pointer font-semibold">Every rep ({result.reps.length})</summary>
          <ol className="mt-3 divide-y divide-line/50 text-sm">
            {result.reps.map((r) => (
              <li key={r.index} className="flex items-center gap-3 py-2">
                <span className="w-6 text-dim tabular">{r.index}</span>
                {r.valid ? (
                  <span className="flex-1">
                    Form <strong className="tabular">{Math.round(r.formScore)}</strong>
                    <span className="text-mist"> — elbows {Math.round(r.minElbowAngle)}°, body {Math.round(r.meanBodyDeviation)}° off straight</span>
                    {r.confidence < 0.6 && <span className="text-jersey"> (low confidence)</span>}
                  </span>
                ) : (
                  <span className="flex-1 text-flag">Didn't count — {r.invalidReason?.toLowerCase()}</span>
                )}
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
          <p className="font-semibold text-go">{visibility === 'groups' ? 'Posted to your groups.' : 'Saved privately.'}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => navigate('/feed')}>See the feed</Button>
            <Button variant="secondary" onClick={onAgain}>
              Do another set
            </Button>
          </div>
        </div>
      ) : (
        <section className="space-y-3 rounded-[var(--radius-card)] bg-court p-4">
          <label className="block">
            <span className="text-sm text-mist">Add a note (optional)</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={280}
              placeholder="Lunch break set before the lecture"
              className="mt-1 h-11 w-full rounded-xl border border-line bg-ink px-3 text-chalk placeholder:text-dim focus:border-jersey focus:outline-none"
            />
          </label>
          <Segmented
            label="Who can see this"
            value={visibility}
            onChange={setVisibility}
            options={[
              { value: 'groups', label: 'My groups' },
              { value: 'private', label: 'Only me' },
            ]}
          />
          {save.isError && <ErrorNote error={save.error} />}
          <div className="flex flex-wrap gap-2">
            <Button size="lg" onClick={submit} loading={save.isPending} disabled={result.reps.length === 0}>
              <Users className="size-5" aria-hidden /> {visibility === 'groups' ? 'Post to my groups' : 'Save privately'}
            </Button>
            <Button size="lg" variant="ghost" onClick={onAgain}>
              Discard
            </Button>
          </div>
          {result.reps.length === 0 && (
            <p className="text-sm text-mist">
              No reps were detected. Check the setup tips and try again — or <Link to="/workout" onClick={onAgain} className="underline">use the demo athlete</Link>.
            </p>
          )}
        </section>
      )}
    </div>
  )
}
