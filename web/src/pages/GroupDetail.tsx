import { ArrowLeft, Copy, RefreshCw, Share2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ChallengeCard } from '../components/ChallengeCard'
import { LeaderboardPanel } from '../components/LeaderboardPanel'
import { WorkoutCard } from '../components/WorkoutCard'
import { Avatar, Badge, Button, EmptyState, ErrorNote, SectionTitle, Spinner } from '../components/ui'
import { plural } from '../lib/format'
import { useFeed, useGroup, useLeaveGroup, useMe, useRotateInvite } from '../lib/queries'

export default function GroupDetail() {
  const id = Number(useParams().id)
  const group = useGroup(id)
  const me = useMe()
  const feed = useFeed(id)
  const leave = useLeaveGroup()
  const rotate = useRotateInvite(id)
  const navigate = useNavigate()
  const [copied, setCopied] = useState(false)

  if (group.isPending) return <Spinner label="Loading group" />
  if (group.isError) return <ErrorNote error={group.error} />
  const g = group.data
  const inviteUrl = g.inviteCode ? `${window.location.origin}/join/${g.inviteCode}` : null
  const items = feed.data?.pages.flatMap((p) => p.items) ?? []

  const share = async () => {
    if (!inviteUrl) return
    if (navigator.share) {
      try {
        await navigator.share({ title: `Join ${g.name} on Striqs`, url: inviteUrl })
        return
      } catch {
        /* cancelled — fall through to copy */
      }
    }
    await navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="space-y-8">
      <div>
        <Link to="/groups" className="inline-flex items-center gap-1 text-sm text-mist hover:text-chalk">
          <ArrowLeft className="size-4" aria-hidden /> Groups
        </Link>
        <h1 className="mt-2 font-display text-[44px] leading-[0.95] font-semibold tracking-[-0.03em]">{g.name}</h1>
        {g.description && <p className="mt-2 text-mist">{g.description}</p>}
        <div className="mt-3 flex -space-x-1.5">
          {g.members.slice(0, 8).map((m) => (
            <span key={m.user.id} className="rounded-full ring-2 ring-ink">
              <Avatar user={m.user} size={32} />
            </span>
          ))}
          <span className="pl-4 text-sm leading-8 text-mist">{plural(g.memberCount, 'member')}</span>
        </div>
      </div>

      {g.inviteCode && (
        <section className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-dashed border-accent/50 p-4">
          <div className="flex-1">
            <p className="text-sm text-mist">Invite code</p>
            <p className="font-display text-4xl leading-none font-semibold tracking-[0.12em] text-accent">{g.inviteCode}</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={share}>
              {copied ? <Copy className="size-4" aria-hidden /> : <Share2 className="size-4" aria-hidden />}
              {copied ? 'Link copied' : 'Share invite'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => rotate.mutate()} loading={rotate.isPending} title="Make a new code; the old one stops working">
              <RefreshCw className="size-4" aria-hidden /> New code
            </Button>
          </div>
        </section>
      )}

      <ChallengeCard group={g} />
      <LeaderboardPanel groupId={id} myUserId={me.data?.id} />

      <section>
        <SectionTitle>Group activity</SectionTitle>
        {feed.isPending ? (
          <Spinner />
        ) : items.length === 0 ? (
          <EmptyState title="Quiet in here" body="Be the first to post a set to this group." action={<Link to="/workout"><Button>Start a set</Button></Link>} />
        ) : (
          <div className="space-y-4">
            {items.map((w) => (
              <WorkoutCard key={w.id} w={w} />
            ))}
            {feed.hasNextPage && (
              <Button variant="secondary" onClick={() => feed.fetchNextPage()} loading={feed.isFetchingNextPage}>
                Show older posts
              </Button>
            )}
          </div>
        )}
      </section>

      <section>
        <SectionTitle>Members</SectionTitle>
        <ul className="divide-y divide-line/40 rounded-[var(--radius-card)] bg-court">
          {g.members.map((m) => (
            <li key={m.user.id} className="flex items-center gap-3 px-4 py-3">
              <Avatar user={m.user} size={36} />
              <Link to={`/u/${m.user.username}`} className="min-w-0 flex-1 truncate hover:underline">
                {m.user.displayName} <span className="text-sm text-dim">@{m.user.username}</span>
              </Link>
              {m.role !== 'member' && <Badge>{m.role}</Badge>}
              {m.user.isDemo && <Badge>Demo</Badge>}
            </li>
          ))}
        </ul>
        {g.myRole !== 'owner' && me.data && (
          <Button
            variant="danger"
            size="sm"
            className="mt-4"
            loading={leave.isPending}
            onClick={() => {
              if (confirm(`Leave ${g.name}? Your past sets stay on your profile.`))
                leave.mutate({ groupId: id, userId: me.data.id }, { onSuccess: () => navigate('/groups') })
            }}
          >
            Leave group
          </Button>
        )}
      </section>
    </div>
  )
}
