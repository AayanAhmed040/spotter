import { useAuth0 } from '@auth0/auth0-react'
import { Check, KeyRound, LogOut, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Avatar, Badge, Button, ErrorNote, SectionTitle, Spinner } from '../components/ui'
import { decodeJwtPayload } from '../lib/api'
import { useAuthSession, useMe, useUpdateMe } from '../lib/queries'

export default function Account() {
  const { user, logout, getAccessTokenSilently } = useAuth0()
  const me = useMe()
  const session = useAuthSession()
  const update = useUpdateMe()
  const [claims, setClaims] = useState<Record<string, unknown> | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')

  useEffect(() => {
    if (me.data) {
      setDisplayName(me.data.displayName)
      setUsername(me.data.username)
    }
  }, [me.data])

  useEffect(() => {
    getAccessTokenSilently()
      .then((t) => setClaims(t ? decodeJwtPayload(t) : null))
      .catch(() => setClaims(null))
  }, [getAccessTokenSilently])

  const provider = String(user?.sub ?? '').split('|')[0]
  const providerName: Record<string, string> = {
    auth0: 'Email & password',
    'google-oauth2': 'Google',
    github: 'GitHub',
    apple: 'Apple',
    windowslive: 'Microsoft',
  }
  const exp = typeof claims?.exp === 'number' ? new Date(claims.exp * 1000) : null

  return (
    <div className="space-y-8">
      <section>
        <SectionTitle>Your profile</SectionTitle>
        {me.isPending ? (
          <Spinner />
        ) : me.data ? (
          <form
            className="space-y-3 rounded-[var(--radius-card)] bg-court p-4"
            onSubmit={(e) => {
              e.preventDefault()
              update.mutate({
                displayName: displayName.trim() !== me.data.displayName ? displayName.trim() : undefined,
                username: username !== me.data.username ? username : undefined,
              })
            }}
          >
            <div className="flex items-center gap-3">
              <Avatar user={me.data} size={56} />
              <p className="text-sm text-mist">Your photo comes from your sign-in provider.</p>
            </div>
            <label className="block">
              <span className="text-sm text-mist">Display name</span>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={80}
                required
                className="mt-1 h-11 w-full rounded-xl border border-line bg-ink px-3 focus:border-jersey focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-sm text-mist">Username</span>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                minLength={3}
                maxLength={20}
                required
                className="mt-1 h-11 w-full rounded-xl border border-line bg-ink px-3 focus:border-jersey focus:outline-none"
              />
            </label>
            {update.isError && <ErrorNote error={update.error} />}
            {update.isSuccess && <p className="text-sm text-go">Profile saved.</p>}
            <Button type="submit" loading={update.isPending}>
              Save profile
            </Button>
          </form>
        ) : (
          <ErrorNote error={me.error} />
        )}
      </section>

      <section>
        <SectionTitle>How your sign-in is protected</SectionTitle>
        <div className="space-y-4 rounded-[var(--radius-card)] bg-court p-4">
          <Row icon={KeyRound} title="Signed in with Auth0">
            {providerName[provider] ?? provider} account
            {user?.email && (
              <>
                {' '}
                ({user.email}
                {user.email_verified ? ', verified' : ', not verified'})
              </>
            )}
            . Spotter never sees or stores your password — Auth0 Universal Login handles it, using the Authorization Code
            flow with PKCE.
          </Row>
          <Row icon={ShieldCheck} title="Every request carries a short-lived access token">
            {claims ? (
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
                <dt className="text-dim">Issuer</dt>
                <dd className="break-all">{String(claims.iss)}</dd>
                <dt className="text-dim">Audience</dt>
                <dd className="break-all">{([] as unknown[]).concat(claims.aud).join(', ')}</dd>
                <dt className="text-dim">Scopes</dt>
                <dd>{String(claims.scope ?? '')}</dd>
                <dt className="text-dim">Expires</dt>
                <dd>{exp?.toLocaleTimeString()} — refreshed silently with a rotating refresh token</dd>
              </dl>
            ) : (
              'Loading token details…'
            )}
          </Row>
          <div className="rounded-2xl bg-ink/50 p-3">
            <div className="flex items-center gap-2">
              <p className="font-semibold">What the API just verified</p>
              {session.data?.verified && <Badge tone="good">Verified</Badge>}
            </div>
            {session.isPending ? (
              <Spinner />
            ) : session.isError ? (
              <ErrorNote error={session.error} />
            ) : (
              <ul className="mt-2 space-y-1.5 text-sm">
                {session.data.checks.map((c) => (
                  <li key={c} className="flex gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-go" aria-hidden />
                    {c}
                  </li>
                ))}
                <li className="pt-1 text-xs text-dim">
                  Your Auth0 ID <code className="text-mist">{session.data.subject}</code> maps to Spotter user #
                  {session.data.appUserId}. Group roles and workout ownership are enforced by the API, not the browser.
                </li>
              </ul>
            )}
          </div>
        </div>
      </section>

      <Button variant="danger" onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}>
        <LogOut className="size-4" aria-hidden /> Sign out
      </Button>
    </div>
  )
}

function Row({ icon: Icon, title, children }: { icon: typeof KeyRound; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <Icon className="mt-0.5 size-5 shrink-0 text-jersey" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        <div className="text-sm text-mist">{children}</div>
      </div>
    </div>
  )
}
