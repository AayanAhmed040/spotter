import { Play } from 'lucide-react'
import { useState } from 'react'
import { LogoMark } from './Logo'
import { cx } from './ui'

/**
 * A place for a real video. Drop the file into web/public/media/ under the
 * name passed as `src` and it plays here; until then a branded placeholder shows.
 */
export function VideoSlot({
  src,
  poster,
  label,
  className,
  autoPlay = false,
}: {
  src: string
  poster?: string
  /** What the video shows, for screen readers and the placeholder. */
  label: string
  className?: string
  autoPlay?: boolean
}) {
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading')

  return (
    <div className={cx('relative aspect-video w-full overflow-hidden rounded-[var(--radius-card)] bg-court ring-1 ring-line/70', className)}>
      {state !== 'missing' && (
        <video
          src={src}
          poster={poster}
          aria-label={label}
          // contain, not cover: screen recordings must keep the rep counter and coaching bar in view.
          className={cx('absolute inset-0 size-full object-contain', state !== 'ready' && 'invisible')}
          playsInline
          muted={autoPlay}
          autoPlay={autoPlay}
          loop={autoPlay}
          controls={!autoPlay}
          preload="metadata"
          onLoadedData={() => setState('ready')}
          onError={() => setState('missing')}
        />
      )}
      {state !== 'ready' && (
        <div className="absolute inset-0 grid place-items-center">
          <LogoMark className="absolute -right-6 -bottom-8 h-48 text-accent/[0.06]" />
          <div className="relative text-center">
            <span className="mx-auto grid size-14 place-items-center rounded-full bg-accent/10 text-accent ring-1 ring-accent/30">
              <Play className="size-6 translate-x-0.5" aria-hidden />
            </span>
            <p className="mt-3 text-sm font-semibold text-chalk">{label}</p>
            <p className="mt-0.5 text-xs text-dim">{state === 'loading' ? 'Loading video…' : 'Video coming soon'}</p>
            {import.meta.env.DEV && state === 'missing' && (
              <p className="mt-1 px-4 text-[11px] break-all text-dim/70">Dev: add web/public{src}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
