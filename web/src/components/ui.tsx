import { Loader2 } from 'lucide-react'
import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import type { UserPublic } from '../lib/types'

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-ink hover:bg-accent-hi font-semibold',
  secondary: 'bg-court-hi text-chalk hover:bg-line border border-line',
  ghost: 'text-mist hover:text-chalk hover:bg-court',
  danger: 'bg-flag/15 text-flag hover:bg-flag/25 border border-flag/30',
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-full transition-colors disabled:opacity-50',
        size === 'sm' && 'h-9 px-4 text-sm',
        size === 'md' && 'h-11 px-5 text-[15px]',
        size === 'lg' && 'h-14 px-7 text-base',
        variants[variant],
        className,
      )}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  )
}

export function Avatar({ user, size = 40 }: { user: Pick<UserPublic, 'displayName' | 'avatarUrl'>; size?: number }) {
  const initials = user.displayName
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
  const [broken, setBroken] = useState(false)
  return user.avatarUrl && !broken ? (
    <img
      src={user.avatarUrl}
      alt=""
      width={size}
      height={size}
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
      className="shrink-0 rounded-full bg-court-hi object-cover"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full bg-[#223a66] font-semibold text-sky"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials || '?'}
    </span>
  )
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-10 text-mist">
      <Loader2 className="size-5 animate-spin" aria-hidden />
      <span className="text-sm">{label}…</span>
    </div>
  )
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-line px-6 py-10 text-center">
      <h3 className="font-display text-2xl font-bold">{title}</h3>
      <p className="mx-auto mt-2 max-w-sm text-sm text-mist">{body}</p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  )
}

export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Something went wrong.'
  return (
    <div role="alert" className="rounded-2xl border border-flag/30 bg-flag/10 px-4 py-3 text-sm text-flag">
      {message}
      {onRetry && (
        <button onClick={onRetry} className="ml-2 underline underline-offset-2">
          Try again
        </button>
      )}
    </div>
  )
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'ai' | 'sim' | 'good' }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
        tone === 'neutral' && 'bg-court-hi text-mist',
        tone === 'ai' && 'bg-sky/15 text-sky',
        tone === 'sim' && 'bg-warn/15 text-warn',
        tone === 'good' && 'bg-go/15 text-go',
      )}
    >
      {children}
    </span>
  )
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <h2 className="font-display text-[24px] leading-none font-bold tracking-tight">{children}</h2>
      {action}
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-full bg-court p-1">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'h-8 rounded-full px-3 text-sm transition-colors',
            value === o.value ? 'bg-chalk font-semibold text-ink' : 'text-mist hover:text-chalk',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Horizontal bar for a 0–100 value. */
export function Meter({ value, tone = 'accent' }: { value: number; tone?: 'accent' | 'go' | 'warn' | 'flag' | 'sky' }) {
  const color = { accent: 'bg-accent', go: 'bg-go', warn: 'bg-warn', flag: 'bg-flag', sky: 'bg-sky' }[tone]
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-court-hi" aria-hidden>
      <div className={cx('h-full rounded-full transition-[width] duration-500', color)} style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
    </div>
  )
}
