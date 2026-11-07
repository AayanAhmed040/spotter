import { Award, Lock } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ActivityCalendar } from '../components/ActivityCalendar'
import { InsightCard } from '../components/InsightCard'
import { WorkoutCard } from '../components/WorkoutCard'
import { Avatar, Badge, Button, cx, ErrorNote, SectionTitle, Spinner } from '../components/ui'
import { score } from '../lib/format'
import { useDayWorkouts, useProfile } from '../lib/queries'

export default function Profile() {
  const { username = '' } = useParams()
  const q = useProfile(username)
  const [day, setDay] = useState<string | null>(null)
  const dayWorkouts = useDayWorkouts(username, day)

  if (q.isPending) return <Spinner label="Loading profile" />
  if (q.isError) return <ErrorNote error={q.error} />
  const { user, stats, calendar, isMe } = q.data
  const activeDays = calendar.filter((d) => d.workouts > 0).length

  return (
    <div className="space-y-8">
      <header className="flex items-center gap-4">
        <Avatar user={user} size={72} />
        <div className="min-w-0">
          <h1 className="truncate font-display text-4xl leading-none font-black">{user.displayName}</h1>
          <p className="mt-1 flex items-center gap-2 text-mist">
            @{user.username}
            {user.isDemo && <Badge>Demo account</Badge>}
          </p>
        </div>
        {isMe && (
          <Link to="/account" className="ml-auto">
            <Button variant="secondary" size="sm">
              Edit
            </Button>
          </Link>
        )}
      </header>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="valid push-ups" value={stats.totalValidReps.toLocaleString()} />
        <Stat label="best score" value={score(stats.bestScore)} />
        <Stat label="average form" value={score(stats.averageFormScore)} />
        <Stat
          label={stats.activeWeeksStreak === 1 ? 'active week in a row' : 'active weeks in a row'}
          value={String(stats.activeWeeksStreak)}
          accent
        />
      </dl>

      {isMe && <InsightCard />}

      <section>
        <SectionTitle>Consistency</SectionTitle>
        <div className="rounded-[var(--radius-card)] bg-court p-4">
          <p className="mb-3 text-sm text-mist">
            {activeDays} active days in the last 26 weeks. Rest days are part of getting stronger — a few sessions a week is
            the goal, not every day.
          </p>
          <ActivityCalendar days={calendar} selected={day} onSelect={setDay} />
        </div>
        {day && (
          <div className="mt-4 space-y-3">
            <h3 className="font-semibold">
              {new Date(day + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
            </h3>
            {dayWorkouts.isPending ? (
              <Spinner />
            ) : dayWorkouts.data?.length ? (
              dayWorkouts.data.map((w) => <WorkoutCard key={w.id} w={w} />)
            ) : (
              <p className="text-sm text-mist">Rest day — no sets logged{!isMe && ' (or only private ones)'}.</p>
            )}
          </div>
        )}
      </section>

      <section>
        <SectionTitle>Milestones</SectionTitle>
        <ul className="grid gap-2 sm:grid-cols-2">
          {stats.achievements.map((a) => (
            <li
              key={a.id}
              className={cx('flex items-start gap-3 rounded-2xl p-3', a.earned ? 'bg-court' : 'border border-dashed border-line text-dim')}
            >
              {a.earned ? <Award className="mt-0.5 size-5 shrink-0 text-jersey" aria-hidden /> : <Lock className="mt-0.5 size-5 shrink-0" aria-hidden />}
              <div>
                <p className={cx('font-semibold', a.earned && 'text-chalk')}>{a.title}</p>
                <p className="text-sm">{a.description}</p>
              </div>
            </li>
          ))}
        </ul>
        {isMe && stats.simulatedWorkouts > 0 && (
          <p className="mt-3 text-xs text-dim">{stats.simulatedWorkouts} simulated demo sets aren't counted in these stats.</p>
        )}
      </section>
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl bg-court px-4 py-3">
      <dd className={cx('font-display text-4xl leading-none font-black tabular', accent && 'text-go')}>{value}</dd>
      <dt className="mt-1 text-xs text-mist">{label}</dt>
    </div>
  )
}
