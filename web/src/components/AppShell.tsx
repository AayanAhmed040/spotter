import { Home, Settings, User, Users } from 'lucide-react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { cx } from './ui'
import { Logo, LogoMark } from './Logo'

const NAV = [
  { to: '/feed', label: 'Feed', icon: Home },
  { to: '/groups', label: 'Groups', icon: Users },
  { to: '/workout', label: 'Start', icon: null },
  { to: '/me', label: 'You', icon: User },
  { to: '/account', label: 'Account', icon: Settings },
] as const

export function AppShell() {
  const { pathname } = useLocation()
  const inWorkout = pathname.startsWith('/workout')

  return (
    <div className="min-h-dvh md:pl-56">
      {/* Desktop rail */}
      <aside className="fixed inset-y-0 left-0 hidden w-56 flex-col border-r border-line/60 px-4 py-6 md:flex">
        <NavLink to="/feed" className="px-3">
          <Logo className="text-[34px]" />
        </NavLink>
        <nav className="mt-8 flex flex-col gap-1" aria-label="Main">
          {NAV.map((item) =>
            item.icon ? (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cx(
                    'flex h-11 items-center gap-3 rounded-full px-3 text-[15px] transition-colors',
                    isActive ? 'bg-court-hi font-semibold text-chalk' : 'text-mist hover:bg-court hover:text-chalk',
                  )
                }
              >
                <item.icon className="size-5" aria-hidden />
                {item.label}
              </NavLink>
            ) : (
              <NavLink
                key={item.to}
                to={item.to}
                className="my-3 flex h-12 items-center justify-center gap-2 rounded-full bg-accent font-semibold text-ink hover:bg-accent-hi"
              >
                <LogoMark className="h-4 w-auto" />
                Start a workout
              </NavLink>
            ),
          )}
        </nav>
      </aside>

      {/* Mobile header */}
      {!inWorkout && (
        <header className="safe-top sticky top-0 z-30 border-b border-line/50 bg-ink/90 backdrop-blur md:hidden">
          <div className="flex h-14 items-center px-4">
            <Logo className="text-[28px]" />
          </div>
        </header>
      )}

      <main className={cx('mx-auto w-full max-w-2xl px-4', inWorkout ? 'pt-3 pb-28' : 'pt-5 pb-32 md:pt-10')}>
        <Outlet />
      </main>

      {/* Mobile tab bar */}
      <nav
        aria-label="Main"
        className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line/60 bg-ink/95 backdrop-blur md:hidden"
      >
        <div className="mx-auto grid max-w-md grid-cols-5 items-end px-2 pt-1.5">
          {NAV.map((item) =>
            item.icon ? (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cx('flex flex-col items-center gap-0.5 py-1 text-[11px]', isActive ? 'text-chalk' : 'text-dim')
                }
              >
                {({ isActive }) => (
                  <>
                    <item.icon className={cx('size-6', isActive && 'text-accent')} strokeWidth={isActive ? 2.4 : 1.8} aria-hidden />
                    {item.label}
                  </>
                )}
              </NavLink>
            ) : (
              <NavLink key={item.to} to={item.to} aria-label="Start a workout" className="flex flex-col items-center gap-0.5 text-[11px] text-chalk">
                <span className="-mt-6 grid size-14 place-items-center rounded-full bg-accent text-ink shadow-[0_6px_24px_-6px_rgba(198,220,242,0.55)] ring-4 ring-ink">
                  <LogoMark className="h-5 w-auto" />
                </span>
                Start
              </NavLink>
            ),
          )}
        </div>
      </nav>
    </div>
  )
}
