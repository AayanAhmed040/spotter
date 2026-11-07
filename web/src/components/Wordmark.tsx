import { cx } from './ui'

/** "SPOTTER" set in the scoreboard face, with the O drawn as a rep-counter dot. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx('font-display font-black tracking-tight text-chalk select-none', className)} aria-label="Spotter">
      <span aria-hidden>
        Sp
        <span className="relative inline-block">
          o
          <span className="absolute top-[0.36em] left-1/2 size-[0.16em] -translate-x-1/2 rounded-full bg-jersey" />
        </span>
        tter
      </span>
    </span>
  )
}
