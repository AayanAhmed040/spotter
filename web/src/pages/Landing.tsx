import { useAuth0 } from '@auth0/auth0-react'
import { Link, Navigate } from 'react-router-dom'
import { LiveDemo } from '../components/LiveDemo'
import { Button } from '../components/ui'
import { Wordmark } from '../components/Wordmark'
import { isAuthConfigured } from '../lib/config'

export default function Landing() {
  const { isAuthenticated, isLoading, loginWithRedirect } = useAuth0()
  if (isAuthConfigured && isAuthenticated) return <Navigate to="/feed" replace />

  const signIn = () => loginWithRedirect({ appState: { returnTo: '/feed' } })
  const signUp = () => loginWithRedirect({ appState: { returnTo: '/groups' }, authorizationParams: { screen_hint: 'signup' } })

  return (
    <div className="safe-top mx-auto max-w-6xl px-5 pb-16">
      <header className="flex h-16 items-center justify-between">
        <Wordmark className="text-4xl" />
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

      <section className="grid items-center gap-10 pt-6 md:grid-cols-[1fr_1.15fr] md:pt-14">
        <div>
          <h1 className="font-display text-[56px] leading-[0.88] font-black sm:text-7xl">
            Push-ups, counted by AI. Cheered on by your crew.
          </h1>
          <p className="mt-5 max-w-md text-lg text-mist">
            Prop up your phone, do your set. Spotter counts every rep, scores your form, and shares the result with the
            people who keep you showing up.
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
        <LiveDemo />
      </section>

      <section className="mt-20 grid gap-8 md:grid-cols-3">
        <Pillar title="Your camera is the coach">
          Pose tracking runs in the browser. It counts only full reps — chest down, arms locked out — and tells you
          what to fix while you move.
        </Pillar>
        <Pillar title="Quality beats quantity">
          Your score is 70% form and 30% reps toward a target. Fifteen clean push-ups beat thirty sloppy ones, so
          beginners can win too.
        </Pillar>
        <Pillar title="Better together">
          Make a private group, post your sets, react to each other's, and chase one shared goal where every
          member's reps count.
        </Pillar>
      </section>
    </div>
  )
}

function Pillar({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t-2 border-jersey pt-4">
      <h2 className="font-display text-3xl font-extrabold">{title}</h2>
      <p className="mt-2 text-mist">{children}</p>
    </div>
  )
}
