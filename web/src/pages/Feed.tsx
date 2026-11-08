import { Link } from 'react-router-dom'
import { Play } from 'lucide-react'
import { ChallengeStrip } from '../components/ChallengeCard'
import { WorkoutCard } from '../components/WorkoutCard'
import { Button, EmptyState, ErrorNote, SectionTitle, Spinner } from '../components/ui'
import { useFeed, useGroups } from '../lib/queries'

export default function Feed() {
  const groups = useGroups()
  const feed = useFeed()
  const items = feed.data?.pages.flatMap((p) => p.items) ?? []
  const noGroups = groups.data && groups.data.length === 0

  return (
    <div className="space-y-6">
      {noGroups && (
        <div className="rounded-[var(--radius-card)] bg-accent p-5 text-ink">
          <h2 className="font-display text-3xl leading-tight font-semibold tracking-tight">Workouts are better with company</h2>
          <p className="mt-2 text-[15px]">Start a group for your friends, team or club — or join one with an invite code.</p>
          <Link to="/groups" className="mt-4 inline-flex h-10 items-center rounded-full bg-ink px-4 text-sm font-semibold text-chalk">
            Find your crew
          </Link>
        </div>
      )}

      {groups.data?.filter((g) => g.activeChallengeId).slice(0, 2).map((g) => <ChallengeStrip key={g.id} group={g} />)}

      <section>
        <SectionTitle
          action={
            <Link to="/workout" className="hidden md:block">
              <Button size="sm">
                <Play className="size-4" aria-hidden /> Start a workout
              </Button>
            </Link>
          }
        >
          Latest from your groups
        </SectionTitle>
        {feed.isPending ? (
          <Spinner label="Loading the feed" />
        ) : feed.isError ? (
          <ErrorNote error={feed.error} onRetry={() => feed.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            title="Nothing posted yet"
            body="Finish a set and it shows up here for everyone in your groups."
            action={
              <Link to="/workout">
                <Button>Start your first workout</Button>
              </Link>
            }
          />
        ) : (
          <div className="space-y-4">
            {items.map((w) => (
              <WorkoutCard key={w.id} w={w} />
            ))}
            {feed.hasNextPage && (
              <div className="flex justify-center pt-2">
                <Button variant="secondary" onClick={() => feed.fetchNextPage()} loading={feed.isFetchingNextPage}>
                  Show older posts
                </Button>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
