import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { RequireAuth } from './components/RequireAuth'
import { Spinner } from './components/ui'
import { isAuthConfigured } from './lib/config'
import Landing from './pages/Landing'
import SetupNeeded from './pages/SetupNeeded'

const Feed = lazy(() => import('./pages/Feed'))
const Workout = lazy(() => import('./pages/Workout'))
const Groups = lazy(() => import('./pages/Groups'))
const GroupDetail = lazy(() => import('./pages/GroupDetail'))
const JoinByLink = lazy(() => import('./pages/JoinByLink'))
const Profile = lazy(() => import('./pages/Profile'))
const MyProfile = lazy(() => import('./pages/MyProfile'))
const Account = lazy(() => import('./pages/Account'))

export default function App() {
  if (!isAuthConfigured) {
    return (
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="*" element={<SetupNeeded />} />
      </Routes>
    )
  }
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/feed" element={<Lazy el={<Feed />} />} />
        <Route path="/workout" element={<Lazy el={<Workout />} />} />
        <Route path="/groups" element={<Lazy el={<Groups />} />} />
        <Route path="/groups/:id" element={<Lazy el={<GroupDetail />} />} />
        <Route path="/join/:code" element={<Lazy el={<JoinByLink />} />} />
        <Route path="/u/:username" element={<Lazy el={<Profile />} />} />
        <Route path="/me" element={<Lazy el={<MyProfile />} />} />
        <Route path="/account" element={<Lazy el={<Account />} />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function Lazy({ el }: { el: React.ReactNode }) {
  return <Suspense fallback={<Spinner />}>{el}</Suspense>
}
