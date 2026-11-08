import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ExerciseId, HoldWindow, RepBase } from '../exercises/shared/types'
import { useApi } from './api'
import { TIMEZONE } from './config'
import type {
  Challenge,
  FeedPage,
  Group,
  GroupDetail,
  Insight,
  Leaderboard,
  Me,
  Profile,
  ReactionKind,
  Workout,
} from './types'

export const keys = {
  me: ['me'] as const,
  feed: (groupId?: number) => ['feed', groupId ?? 'all'] as const,
  groups: ['groups'] as const,
  group: (id: number) => ['group', id] as const,
  leaderboard: (id: number, period: string, exercise: string) => ['leaderboard', id, period, exercise] as const,
  challenges: (id: number) => ['challenges', id] as const,
  profile: (username: string) => ['profile', username] as const,
  dayWorkouts: (username: string, date: string) => ['dayWorkouts', username, date] as const,
  history: (username: string, exercise: string) => ['history', username, exercise] as const,
  insight: ['insight'] as const,
}

export function useMe() {
  const api = useApi()
  return useQuery({ queryKey: keys.me, queryFn: () => api<Me>('/api/me') })
}

export function useFeed(groupId?: number) {
  const api = useApi()
  return useInfiniteQuery({
    queryKey: keys.feed(groupId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams()
      if (groupId) qs.set('groupId', String(groupId))
      if (pageParam) qs.set('before', pageParam)
      return api<FeedPage>(`/api/feed?${qs}`)
    },
    getNextPageParam: (last) => last.nextBefore,
  })
}

export function useGroups() {
  const api = useApi()
  return useQuery({ queryKey: keys.groups, queryFn: () => api<Group[]>('/api/groups') })
}

export function useGroup(id: number) {
  const api = useApi()
  return useQuery({ queryKey: keys.group(id), queryFn: () => api<GroupDetail>(`/api/groups/${id}`) })
}

export function useLeaderboard(id: number, period: 'week' | 'month' | 'all', exercise: ExerciseId) {
  const api = useApi()
  return useQuery({
    queryKey: keys.leaderboard(id, period, exercise),
    queryFn: () => api<Leaderboard>(`/api/groups/${id}/leaderboard?period=${period}&exercise=${exercise}`),
  })
}

export function useChallenges(id: number) {
  const api = useApi()
  return useQuery({ queryKey: keys.challenges(id), queryFn: () => api<Challenge[]>(`/api/groups/${id}/challenges`) })
}

export function useProfile(username: string | undefined) {
  const api = useApi()
  return useQuery({
    queryKey: keys.profile(username ?? ''),
    enabled: Boolean(username),
    queryFn: () => api<Profile>(`/api/users/${username}?tz=${encodeURIComponent(TIMEZONE)}&days=182`),
  })
}

export function useDayWorkouts(username: string, date: string | null) {
  const api = useApi()
  return useQuery({
    queryKey: keys.dayWorkouts(username, date ?? ''),
    enabled: Boolean(date),
    queryFn: () => api<Workout[]>(`/api/users/${username}/workouts?date=${date}&tz=${encodeURIComponent(TIMEZONE)}`),
  })
}

/** A user's recent workouts, optionally for one exercise. */
export function useHistory(username: string, exercise: ExerciseId | 'all') {
  const api = useApi()
  return useQuery({
    queryKey: keys.history(username, exercise),
    enabled: Boolean(username),
    queryFn: () =>
      api<Workout[]>(`/api/users/${username}/workouts?limit=10${exercise === 'all' ? '' : `&exercise=${exercise}`}`),
  })
}

export function useInsight(enabled: boolean) {
  const api = useApi()
  return useQuery({
    queryKey: keys.insight,
    enabled,
    staleTime: 10 * 60_000,
    queryFn: () => api<Insight>(`/api/me/insights?tz=${encodeURIComponent(TIMEZONE)}`),
  })
}

// ---------- mutations ----------

/** Anything a new workout could change. */
function invalidateActivity(qc: ReturnType<typeof useQueryClient>) {
  for (const k of ['feed', 'profile', 'leaderboard', 'challenges', 'dayWorkouts', 'history', 'insight']) {
    qc.invalidateQueries({ queryKey: [k] })
  }
}

/** POST /api/workouts — raw measurements only; the server computes the scores. */
export interface NewWorkout {
  exercise: ExerciseId
  source: 'camera'
  visibility: 'groups' | 'private'
  startedAt: string
  durationMs: number
  note?: string
  // Rep exercises
  targetReps?: number
  reps?: RepBase[]
  // Hold exercises
  targetHoldMs?: number
  holdWindows?: HoldWindow[]
}

export function useSaveWorkout() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (w: NewWorkout) => api<Workout>('/api/workouts', { method: 'POST', json: w }),
    onSuccess: () => invalidateActivity(qc),
  })
}

export function useDeleteWorkout() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api<void>(`/api/workouts/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateActivity(qc),
  })
}

export function useToggleReaction() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, kind }: { id: number; kind: ReactionKind }) =>
      api<Workout>(`/api/workouts/${id}/reactions`, { method: 'POST', json: { kind } }),
    onSuccess: (updated) => {
      // Patch the post in place across every cached feed so the tap feels instant.
      qc.setQueriesData<{ pages: FeedPage[]; pageParams: unknown[] }>({ queryKey: ['feed'] }, (data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((p) => ({
                ...p,
                items: p.items.map((w) => (w.id === updated.id ? { ...w, ...updated } : w)),
              })),
            }
          : data,
      )
      for (const key of ['dayWorkouts', 'history']) {
        qc.setQueriesData<Workout[]>({ queryKey: [key] }, (list) =>
          list?.map((w) => (w.id === updated.id ? { ...w, ...updated } : w)),
        )
      }
      qc.invalidateQueries({ queryKey: ['leaderboard'] })
    },
  })
}

export function useCreateGroup() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; description?: string }) => api<Group>('/api/groups', { method: 'POST', json: body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.groups })
      invalidateActivity(qc)
    },
  })
}

export function useJoinGroup() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (inviteCode: string) => api<Group>('/api/groups/join', { method: 'POST', json: { inviteCode } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.groups })
      invalidateActivity(qc)
    },
  })
}

export function useLeaveGroup() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ groupId, userId }: { groupId: number; userId: number }) =>
      api<void>(`/api/groups/${groupId}/members/${userId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.groups })
      qc.invalidateQueries({ queryKey: ['group'] })
      invalidateActivity(qc)
    },
  })
}

export function useRotateInvite(groupId: number) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api<Group>(`/api/groups/${groupId}/invite-code`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.group(groupId) }),
  })
}

export function useGenerateChallenge(groupId: number) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { difficulty: 'easy' | 'moderate' | 'hard'; days: number; exercise: 'pushup' | 'squat' }) =>
      api<Challenge>(`/api/groups/${groupId}/challenges/generate`, { method: 'POST', json: body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.challenges(groupId) })
      qc.invalidateQueries({ queryKey: keys.group(groupId) })
    },
  })
}

export function useRefreshInsight() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api<Insight>(`/api/me/insights?tz=${encodeURIComponent(TIMEZONE)}&refresh=true`),
    onSuccess: (i) => qc.setQueryData(keys.insight, i),
  })
}

export function useUpdateMe() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { displayName?: string; username?: string }) => api<Me>('/api/me', { method: 'PATCH', json: body }),
    onSuccess: (me) => {
      qc.setQueryData(keys.me, me)
      invalidateActivity(qc)
    },
  })
}
