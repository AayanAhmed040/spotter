import { useEffect, useRef } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button, ErrorNote, Spinner } from '../components/ui'
import { useJoinGroup } from '../lib/queries'

/** /join/ABC123 — invite links land here (after sign-in if needed) and join automatically. */
export default function JoinByLink() {
  const { code = '' } = useParams()
  const join = useJoinGroup()
  const navigate = useNavigate()
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    join.mutate(code, { onSuccess: (g) => navigate(`/groups/${g.id}`, { replace: true }) })
  }, [code, join, navigate])

  if (join.isError)
    return (
      <div className="space-y-4">
        <ErrorNote error={join.error} />
        <Link to="/groups">
          <Button variant="secondary">Back to groups</Button>
        </Link>
      </div>
    )
  return <Spinner label="Joining the group" />
}
