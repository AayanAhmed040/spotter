import { APP_NAME } from '../lib/config'
import { cx } from './ui'

/**
 * The Striqs mark: two slanted blades, redrawn as a vector from the logo.
 * Uses currentColor, so it takes the text colour it sits in.
 */
export function LogoMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 161 118" className={className} fill="currentColor" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <path d={BLADE} />
      <path d={BLADE} transform="rotate(180 80.5 59)" />
    </svg>
  )
}

/** Top blade, traced from the logo; the bottom blade is the same shape turned 180°. */
export const BLADE =
  'M90 1H157Q161 1 160 5C159 17 150 32 132 42C112 48 60 55 32 60Q27 61 29 56L62 15C69 6 78 1 90 1Z'

/** Mark + lowercase wordmark, as in the logo. */
export function Logo({ className, markClassName }: { className?: string; markClassName?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-[0.32em] text-accent select-none', className)} aria-label={APP_NAME}>
      <LogoMark className={cx('h-[0.82em] w-auto shrink-0', markClassName)} />
      <span aria-hidden className="font-display leading-none font-semibold tracking-[-0.035em]">
        striqs
      </span>
    </span>
  )
}
