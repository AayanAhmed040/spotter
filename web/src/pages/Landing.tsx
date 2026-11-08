import { useAuth0 } from '@auth0/auth0-react'
import { Link, Navigate } from 'react-router-dom'
import { Logo } from '../components/Logo'
import { Button } from '../components/ui'
import { VideoSlot } from '../components/VideoSlot'
import { EXERCISE_IDS, EXERCISE_META } from '../exercises/meta'
import { isAuthConfigured } from '../lib/config'

/** Hero clip (web/public/media). Currently the push-up demo recording. */
const HERO_VIDEO = '/media/pushups-demo.mp4'
const HERO_POSTER = '/media/pushups-demo.jpg'

export default function Landing() {
  const { isAuthenticated, isLoading, loginWithRedirect } = useAuth0()
  if (isAuthConfigured && isAuthenticated) return <Navigate to="/feed" replace />

  const signIn = () => loginWithRedirect({ appState: { returnTo: '/feed' } })
  const signUp = () => loginWithRedirect({ appState: { returnTo: '/groups' }, authorizationParams: { screen_hint: 'signup' } })

  return (
    <div className="safe-top mx-auto max-w-6xl px-5 pb-16">
      <header className="flex h-16 items-center justify-between">
        <Logo className="text-[34px]" />
        {isAuthConfigured ? (
          <Button variant="secondary" size="sm" onClick={signIn} disabled={isLoading}>
            Sign in
          </Button>
        ) : (
          <Link to="/setup" className="text-sm text-mist underline underline-offset-4">
            Finish setup
          </Link>
        )}
      </header>

      <section className="grid items-center gap-10 pt-8 md:grid-cols-[1fr_1.15fr] md:pt-16">
        <div>
          <h1 className="font-display text-[46px] leading-[0.98] font-semibold tracking-[-0.03em] sm:text-6xl">
            Your workout, counted by AI. Cheered on by your crew.
          </h1>
          <p className="mt-5 max-w-md text-lg text-mist">
            Prop up your phone and do push-ups, squats or a plank. Striqs counts every rep, times every hold, scores your
            form, and shares it with the people who keep you showing up.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            {isAuthConfigured ? (
              <>
                <Button size="lg" onClick={signUp}>
                  Create an account
                </Button>
                <Button size="lg" variant="secondary" onClick={signIn}>
                  Sign in
                </Button>
              </>
            ) : (
              <Link to="/setup">
                <Button size="lg">Connect Auth0 to start</Button>
              </Link>
            )}
          </div>
          <p className="mt-4 text-sm text-dim">Your camera feed is analysed on your device and never uploaded.</p>
        </div>
        <VideoSlot src={HERO_VIDEO} poster={HERO_POSTER} label="See Striqs in action" autoPlay />
      </section>

      <section className="mt-16 grid gap-3 sm:grid-cols-3" aria-label="Exercises">
        {EXERCISE_IDS.map((id) => (
          <div key={id} className="rounded-2xl bg-court px-4 py-3.5">
            <p className="font-display text-xl font-semibold">{EXERCISE_META[id].name}</p>
            <p className="mt-0.5 text-sm text-mist">{EXERCISE_META[id].measures}</p>
          </div>
        ))}
      </section>

      <section className="mt-16 grid gap-8 md:grid-cols-3">
        <Pillar title="Your camera is the coach">
          Pose tracking runs in the browser. It only counts full reps, pauses the plank timer when your hips drop, and
          tells you what to fix while you move.
        </Pillar>
        <Pillar title="Quality beats quantity">
          Every score is 70% form. Fifteen clean push-ups beat thirty sloppy ones, and a straight 45-second plank beats a
          sagging two-minute one.
        </Pillar>
        <Pillar title="Better together">
          Make a private group, post your sets, react to each other's, and chase a shared goal where every member's reps
          count.
        </Pillar>
      </section>
    </div>
  )
}

function Pillar({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t-2 border-accent pt-4">
      <h2 className="font-display text-2xl font-semibold tracking-tight">{title}</h2>
      <p className="mt-2 text-mist">{children}</p>
    </div>
  )
}
