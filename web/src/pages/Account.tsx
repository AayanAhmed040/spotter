import { useAuth0 } from '@auth0/auth0-react'
import { LogOut } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Avatar, Button, ErrorNote, SectionTitle, Spinner } from '../components/ui'
import { useMe, useUpdateMe } from '../lib/queries'

export default function Account() {
  const { user, logout } = useAuth0()
  const me = useMe()
  const update = useUpdateMe()
  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')

  useEffect(() => {
    if (me.data) {
      setDisplayName(me.data.displayName)
      setUsername(me.data.username)
    }
  }, [me.data])

  const provider = String(user?.sub ?? '').split('|')[0]
  const providerName: Record<string, string> = {
    auth0: 'Email & password',
    'google-oauth2': 'Google',
    github: 'GitHub',
    apple: 'Apple',
    windowslive: 'Microsoft',
  }

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
                className="mt-1 h-11 w-full rounded-xl border border-line bg-ink px-3 focus:border-accent focus:outline-none"
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
                className="mt-1 h-11 w-full rounded-xl border border-line bg-ink px-3 focus:border-accent focus:outline-none"
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

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line p-4">
        <p className="text-sm text-mist">
          Signed in with {providerName[provider] ?? provider}
          {user?.email ? ` as ${user.email}` : ''}.
        </p>
        <Button variant="danger" onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}>
          <LogOut className="size-4" aria-hidden /> Sign out
        </Button>
      </section>
    </div>
  )
}
