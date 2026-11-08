import { Award, Lock } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ActivityCalendar } from '../components/ActivityCalendar'
import { InsightCard } from '../components/InsightCard'
import { WorkoutCard } from '../components/WorkoutCard'
import { Avatar, Badge, Button, cx, EmptyState, ErrorNote, SectionTitle, Segmented, Spinner } from '../components/ui'
import { EXERCISE_IDS, EXERCISE_META } from '../exercises/meta'
import type { ExerciseId } from '../exercises/shared/types'
import { holdTime, score } from '../lib/format'
import { useDayWorkouts, useHistory, useProfile } from '../lib/queries'
import type { ExerciseStats } from '../lib/types'

export default function Profile() {
  const { username = '' } = useParams()
  const q = useProfile(username)
  const [day, setDay] = useState<string | null>(null)
  const [filter, setFilter] = useState<ExerciseId | 'all'>('all')
  const dayWorkouts = useDayWorkouts(username, day)
  const history = useHistory(username, filter)

  if (q.isPending) return <Spinner label="Loading profile" />
  if (q.isError) return <ErrorNote error={q.error} />
  const { user, stats, calendar, isMe } = q.data
  const activeDays = calendar.filter((d) => d.workouts > 0).length

  return (
    <div className="space-y-8">
      <header className="flex items-center gap-4">
        <Avatar user={user} size={72} />
        <div className="min-w-0">
          <h1 className="font-display text-3xl leading-tight font-semibold tracking-tight break-words sm:text-4xl">{user.displayName}</h1>
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

      <dl className="grid grid-cols-3 gap-3">
        <Stat label="workouts" value={String(stats.totalWorkouts)} />
        <Stat label="active this week" value={`${stats.activeDaysThisWeek} ${stats.activeDaysThisWeek === 1 ? 'day' : 'days'}`} />
        <Stat label={stats.activeWeeksStreak === 1 ? 'week in a row' : 'weeks in a row'} value={String(stats.activeWeeksStreak)} accent />
      </dl>

      <section aria-label="By exercise" className="grid gap-3 sm:grid-cols-3">
        {EXERCISE_IDS.map((id) => (
          <ExerciseSummary key={id} id={id} s={stats.byExercise[id]} />
        ))}
      </section>

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
        <SectionTitle>History</SectionTitle>
        <div className="mb-3">
          <Segmented
            label="Filter history by exercise"
            value={filter}
            onChange={setFilter}
            options={[{ value: 'all' as const, label: 'All' }, ...EXERCISE_IDS.map((id) => ({ value: id, label: EXERCISE_META[id].name }))]}
          />
        </div>
        {history.isPending ? (
          <Spinner />
        ) : history.isError ? (
          <ErrorNote error={history.error} onRetry={() => history.refetch()} />
        ) : history.data.length === 0 ? (
          <EmptyState
            title="No workouts here yet"
            body={isMe ? 'Finish a set and it shows up here.' : "Nothing shared yet for this exercise."}
            action={
              isMe ? (
                <Link to={`/workout${filter === 'all' ? '' : `?exercise=${filter}`}`}>
                  <Button>Start a workout</Button>
                </Link>
              ) : undefined
            }
          />
        ) : (
          <div className="space-y-4">
            {history.data.map((w) => (
              <WorkoutCard key={w.id} w={w} />
            ))}
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
              {a.earned ? <Award className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden /> : <Lock className="mt-0.5 size-5 shrink-0" aria-hidden />}
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

/** Each exercise on its own terms — scores are never compared across exercises. */
function ExerciseSummary({ id, s }: { id: ExerciseId; s: ExerciseStats }) {
  const meta = EXERCISE_META[id]
  const empty = s.workouts === 0
  return (
    <div className="rounded-2xl bg-court p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-display text-lg font-semibold">{meta.name}</h3>
        <span className="text-xs text-dim">{empty ? 'Not tried yet' : `${s.workouts} ${s.workouts === 1 ? 'set' : 'sets'}`}</span>
      </div>
      {empty ? (
        <Link to={`/workout?exercise=${id}`} className="mt-3 inline-block text-sm text-accent underline-offset-4 hover:underline">
          Try {meta.plural === 'planks' ? 'a plank' : meta.plural}
        </Link>
      ) : (
        <dl className="mt-3 grid grid-cols-3 gap-2">
          {meta.kind === 'hold' ? (
            <>
              <Mini label="longest" value={holdTime(s.longestHoldMs)} />
              <Mini label="total" value={holdTime(s.totalHoldMs)} />
            </>
          ) : (
            <>
              <Mini label="total" value={(s.totalValidReps ?? 0).toLocaleString()} />
              <Mini label="best set" value={String(s.bestReps ?? 0)} />
            </>
          )}
          <Mini label="best score" value={score(s.bestScore)} />
        </dl>
      )}
      {!empty && s.averageFormScore !== null && (
        <p className="mt-2 text-xs text-mist">
          Average form {Math.round(s.averageFormScore)}
          {s.formImprovement !== null && s.formImprovement > 0 && <span className="text-go"> — up {s.formImprovement}</span>}
        </p>
      )}
    </div>
  )
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dd className="font-display text-xl leading-none font-semibold tabular">{value}</dd>
      <dt className="mt-1 text-[11px] text-mist">{label}</dt>
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl bg-court px-4 py-3">
      <dd className={cx('font-display text-3xl leading-none font-semibold tabular', accent && 'text-go')}>{value}</dd>
      <dt className="mt-1 text-xs text-mist">{label}</dt>
    </div>
  )
}
