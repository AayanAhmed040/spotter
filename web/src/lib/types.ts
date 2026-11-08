import type { ExerciseId, HoldWindow, MetricKind } from '../exercises/shared/types'

export interface UserPublic {
  id: number
  username: string
  displayName: string
  avatarUrl: string | null
  isDemo: boolean
}

export interface Me extends UserPublic {
  email: string | null
  createdAt: string
}

export type ReactionKind = 'strong' | 'fire' | 'clap' | 'form'

export interface Workout {
  id: number
  user: UserPublic
  exercise: ExerciseId
  /** reps: push-ups, squats · hold: plank. Rep fields are null for holds and vice versa. */
  metricKind: MetricKind
  source: 'camera' | 'demo' | 'seed'
  visibility: 'groups' | 'private'
  startedAt: string
  durationMs: number
  targetReps: number | null
  validReps: number | null
  attemptedReps: number | null
  repScore: number | null
  targetHoldMs: number | null
  holdMs: number | null
  longestHoldMs: number | null
  holdScore: number | null
  formScore: number
  volumeScore: number | null
  finalScore: number
  consistency: number
  confidence: number
  componentAverages: Record<string, number>
  scoringVersion: number
  note: string | null
  reactions: Record<ReactionKind, number>
  myReactions: ReactionKind[]
  isMine: boolean
  reps?: (Record<string, unknown> & { index: number; valid: boolean; invalidReason: string | null; formScore: number })[]
  holdWindows?: (HoldWindow & { formScore: number; counted: boolean })[]
}

export interface FeedPage {
  items: Workout[]
  nextBefore: string | null
}

export interface Group {
  id: number
  name: string
  description: string | null
  inviteCode: string | null
  myRole: 'owner' | 'admin' | 'member'
  memberCount: number
  activeChallengeId: number | null
  createdAt: string
}

export interface GroupDetail extends Group {
  members: { user: UserPublic; role: Group['myRole']; joinedAt: string }[]
}

export interface LeaderboardRow {
  user: UserPublic
  role: string
  bestScore: number | null
  averageScore: number | null
  /** Rep exercises only. */
  totalValidReps: number | null
  /** Hold exercises only. */
  totalHoldMs: number | null
  longestHoldMs: number | null
  workouts: number
  activeDays: number
  improvement: number | null
  cheersGiven: number
}

export type LeaderboardCategory = 'topScore' | 'mostReps' | 'longestHold' | 'mostConsistent' | 'mostImproved' | 'mostEncouraging'

export interface Leaderboard {
  period: 'week' | 'month' | 'all'
  exercise: ExerciseId
  metricKind: MetricKind
  rows: LeaderboardRow[]
  categories: Partial<Record<LeaderboardCategory, number[]>>
}

export interface Challenge {
  id: number
  groupId: number
  title: string
  description: string
  exercise: ExerciseId
  goalReps: number
  minSessionsPerMember: number
  difficulty: 'easy' | 'moderate' | 'hard'
  startsAt: string
  endsAt: string
  active: boolean
  source: 'gemini' | 'rules'
  aiModel: string | null
  rationale: string | null
  progressReps: number
  progress: number
  membersParticipating: number
  membersMetMinimum: number
  memberCount: number
  contributors: { user: UserPublic; reps: number; sessions: number; metMinimum: boolean }[]
}

export interface CalendarDay {
  date: string
  workouts: number
  reps: number
  holdMs: number
  exercises: ExerciseId[]
  level: 0 | 1 | 2 | 3 | 4
}

export interface Achievement {
  id: string
  title: string
  description: string
  earned: boolean
}

export interface ExerciseStats {
  workouts: number
  bestScore: number | null
  bestFormScore: number | null
  averageFormScore: number | null
  formImprovement: number | null
  lastAt: string | null
  totalValidReps?: number
  bestReps?: number
  totalHoldMs?: number
  longestHoldMs?: number
}

export interface UserStats {
  totalWorkouts: number
  totalValidReps: number
  totalHoldMs: number
  activeDaysThisWeek: number
  activeWeeksStreak: number
  reactionsGiven: number
  groups: number
  simulatedWorkouts: number
  byExercise: Record<ExerciseId, ExerciseStats>
  achievements: Achievement[]
}

export interface Profile {
  user: UserPublic
  isMe: boolean
  stats: UserStats
  calendar: CalendarDay[]
}

export interface Insight {
  weekStart: string
  headline: string
  summary: string
  highlights: string[]
  nextSteps: string[]
  stats: Record<string, unknown>
  source: 'gemini' | 'rules'
  aiModel: string | null
  generatedAt: string
}
