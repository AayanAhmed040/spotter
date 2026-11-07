import { Navigate } from 'react-router-dom'
import { ErrorNote, Spinner } from '../components/ui'
import { useMe } from '../lib/queries'

export default function MyProfile() {
  const me = useMe()
  if (me.isPending) return <Spinner label="Loading your profile" />
  if (me.isError) return <ErrorNote error={me.error} onRetry={() => me.refetch()} />
  return <Navigate to={`/u/${me.data.username}`} replace />
}
