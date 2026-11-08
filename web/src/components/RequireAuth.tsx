import { useAuth0 } from '@auth0/auth0-react'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useApi } from '../lib/api'
import { keys } from '../lib/queries'
import { sessionEvents } from '../lib/session-events'
import type { Me } from '../lib/types'
import { Button } from './ui'
import { Logo } from './Logo'

/**
 * Gate for every signed-in route. While Auth0 resolves the session we show a
 * loading screen; signed-out visitors are sent to Universal Login and returned
 * to the page they asked for afterwards.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, loginWithRedirect, error } = useAuth0()
  const location = useLocation()
  const redirecting = useRef(false)

  useEffect(() => {
    if (!isLoading && !isAuthenticated && !error && !redirecting.current) {
      redirecting.current = true
      void loginWithRedirect({ appState: { returnTo: location.pathname + location.search } })
    }
  }, [isLoading, isAuthenticated, error, loginWithRedirect, location])

  if (error) {
    return (
      <FullScreen>
        <p className="max-w-sm text-center text-mist">Sign-in didn't complete: {error.message}</p>
        <Button onClick={() => loginWithRedirect()}>Try signing in again</Button>
      </FullScreen>
    )
  }
  if (isLoading || !isAuthenticated) {
    return (
      <FullScreen>
        <p className="text-mist" role="status">
          {isLoading ? 'Checking your session…' : 'Taking you to sign in…'}
        </p>
      </FullScreen>
    )
  }
  return (
    <>
      <ProfileSync />
      <SessionExpiredBanner />
      {children}
    </>
  )
}

function FullScreen({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 px-6">
      <Logo className="text-5xl" />
      {children}
    </div>
  )
}

/** Once per sign-in: create or refresh our app profile from the Auth0 identity. */
function ProfileSync() {
  const api = useApi()
  const qc = useQueryClient()
  const { user } = useAuth0()
  const done = useRef<string | null>(null)
  useEffect(() => {
    if (!user?.sub || done.current === user.sub) return
    done.current = user.sub
    api<{ user: Me }>('/api/me/sync', {
      method: 'POST',
      json: { name: user.name, nickname: user.nickname, picture: user.picture },
    })
      .then((r) => qc.setQueryData(keys.me, r.user))
      .catch((e) => console.warn('Profile sync failed', e))
  }, [api, qc, user])
  return null
}

function SessionExpiredBanner() {
  const { loginWithRedirect } = useAuth0()
  const [expired, setExpired] = useState(false)
  const location = useLocation()
  useEffect(() => sessionEvents.subscribe(setExpired), [])
  if (!expired) return null
  return (
    <div role="alert" className="fixed inset-x-3 top-3 z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-accent/40 bg-court p-3 shadow-2xl">
      <p className="flex-1 text-sm">Your session expired. Sign in again to keep going.</p>
      <Button
        size="sm"
        onClick={() => {
          sessionEvents.reset()
          void loginWithRedirect({ appState: { returnTo: location.pathname } })
        }}
      >
        Sign in
      </Button>
    </div>
  )
}
