import type { FormComponents, ScoredRep } from '../pose/types'

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
  exercise: 'pushup'
  source: 'camera' | 'demo' | 'seed'
  visibility: 'groups' | 'private'
  startedAt: string
  durationMs: number
  targetReps: number
  validReps: number
  attemptedReps: number
  formScore: number
  repScore: number
  finalScore: number
  consistency: number
  confidence: number
  componentAverages: FormComponents
  scoringVersion: number
  note: string | null
  reactions: Record<ReactionKind, number>
  myReactions: ReactionKind[]
  isMine: boolean
  reps?: ScoredRep[]
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
  totalValidReps: number
  workouts: number
  activeDays: number
  improvement: number | null
  cheersGiven: number
}

export type LeaderboardCategory = 'topScore' | 'mostReps' | 'mostConsistent' | 'mostImproved' | 'mostEncouraging'

export interface Leaderboard {
  period: 'week' | 'month' | 'all'
  rows: LeaderboardRow[]
  categories: Record<LeaderboardCategory, number[]>
}

export interface Challenge {
  id: number
  groupId: number
  title: string
  description: string
  exercise: string
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
  level: 0 | 1 | 2 | 3 | 4
}

export interface Achievement {
  id: string
  title: string
  description: string
  earned: boolean
}

export interface UserStats {
  totalWorkouts: number
  totalValidReps: number
  bestScore: number | null
  bestFormScore: number | null
  averageFormScore: number | null
  activeDaysThisWeek: number
  activeWeeksStreak: number
  formImprovement: number | null
  reactionsGiven: number
  groups: number
  simulatedWorkouts: number
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
  stats: Record<string, number | string | null>
  source: 'gemini' | 'rules'
  aiModel: string | null
  generatedAt: string
}

export interface AuthSession {
  verified: boolean
  algorithm: string
  issuer: string
  audience: string | string[]
  subject: string
  authorizedParty: string | null
  scopes: string[]
  issuedAt: number
  expiresAt: number
  appUserId: number
  checks: string[]
}
