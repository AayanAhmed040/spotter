import { ChevronRight, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Badge, Button, EmptyState, ErrorNote, SectionTitle, Spinner } from '../components/ui'
import { plural } from '../lib/format'
import { useCreateGroup, useGroups, useJoinGroup } from '../lib/queries'

export default function Groups() {
  const groups = useGroups()
  const navigate = useNavigate()
  const join = useJoinGroup()
  const create = useCreateGroup()
  const [code, setCode] = useState('')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  return (
    <div className="space-y-8">
      <section>
        <SectionTitle
          action={
            !creating && (
              <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
                <Plus className="size-4" aria-hidden /> New group
              </Button>
            )
          }
        >
          Your groups
        </SectionTitle>

        {creating && (
          <form
            className="mb-4 space-y-3 rounded-[var(--radius-card)] bg-court p-4"
            onSubmit={(e) => {
              e.preventDefault()
              create.mutate(
                { name: name.trim(), description: description.trim() || undefined },
                { onSuccess: (g) => navigate(`/groups/${g.id}`) },
              )
            }}
          >
            <h3 className="font-semibold">Start a group</h3>
            <input
              autoFocus
              required
              minLength={2}
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Group name, e.g. MRU Data Science crew"
              aria-label="Group name"
              className="h-11 w-full rounded-xl border border-line bg-ink px-3 placeholder:text-dim focus:border-accent focus:outline-none"
            />
            <input
              maxLength={280}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's it for? (optional)"
              aria-label="Description"
              className="h-11 w-full rounded-xl border border-line bg-ink px-3 placeholder:text-dim focus:border-accent focus:outline-none"
            />
            {create.isError && <ErrorNote error={create.error} />}
            <div className="flex gap-2">
              <Button type="submit" loading={create.isPending}>
                Create group
              </Button>
              <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                Cancel
              </Button>
            </div>
          </form>
        )}

        {groups.isPending ? (
          <Spinner label="Loading groups" />
        ) : groups.isError ? (
          <ErrorNote error={groups.error} onRetry={() => groups.refetch()} />
        ) : groups.data.length === 0 ? (
          !creating && (
            <EmptyState
              title="No groups yet"
              body="Groups are private. Create one and share its invite code, or join a friend's below."
              action={<Button onClick={() => setCreating(true)}>Start a group</Button>}
            />
          )
        ) : (
          <ul className="space-y-2">
            {groups.data.map((g) => (
              <li key={g.id}>
                <Link to={`/groups/${g.id}`} className="flex items-center gap-4 rounded-[var(--radius-card)] bg-court p-4 hover:bg-court-hi">
                  <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-accent font-display text-2xl font-semibold text-ink">
                    {g.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{g.name}</p>
                    <p className="flex flex-wrap items-center gap-2 text-sm text-mist">
                      {plural(g.memberCount, 'member')}
                      {g.myRole !== 'member' && <Badge>{g.myRole}</Badge>}
                      {g.activeChallengeId && <Badge tone="good">Challenge on</Badge>}
                    </p>
                  </div>
                  <ChevronRight className="size-5 text-dim" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-[var(--radius-card)] border border-line p-4">
        <h2 className="font-display text-2xl font-bold">Join with a code</h2>
        <p className="mt-1 text-sm text-mist">Ask a group owner for their six-character invite code.</p>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            join.mutate(code, { onSuccess: (g) => navigate(`/groups/${g.id}`) })
          }}
        >
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            maxLength={12}
            placeholder="ABC234"
            aria-label="Invite code"
            autoCapitalize="characters"
            className="h-11 w-36 rounded-xl border border-line bg-ink px-3 font-display text-xl font-semibold tracking-widest placeholder:text-dim focus:border-accent focus:outline-none"
          />
          <Button type="submit" loading={join.isPending} disabled={code.length < 4}>
            Join group
          </Button>
        </form>
        {join.isError && (
          <div className="mt-3">
            <ErrorNote error={join.error} />
          </div>
        )}
      </section>
    </div>
  )
}
