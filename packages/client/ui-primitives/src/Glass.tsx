import type { ReactNode } from 'react'
import clsx from 'clsx'
import css from './Glass.module.css'

/** Glass elevation variant: panel (major surface), card (in-thread card), well (recessed). */
export type GlassVariant = 'panel' | 'card' | 'well'

/** Display options for a glass surface. */
export interface GlassSurfaceProps {
  /** Elevation variant; defaults to 'panel'. */
  variant?: GlassVariant | undefined
  /** Whether one sheen pass crosses the surface on mount; defaults to false. */
  sheen?: boolean | undefined
  /** Extra class for layout placement. */
  className?: string | undefined
  /** Surface content. */
  children?: ReactNode
}

/**
 * Render the shared glass recipe (translucent fill, backdrop blur, hairline,
 * top inner highlight) as a surface. The recipe values ride the shell's
 * `--glass-*` tokens (ui-layout publishes them at body scope); the fallbacks
 * in Glass.module.css restate the same values so the primitive also stands
 * alone. Corner radius rides `--glass-radius` when the host surface sets it.
 * @param props - see {@link GlassSurfaceProps}.
 * @returns the surface element.
 */
export function GlassSurface({ variant = 'panel', sheen = false, className, children }: GlassSurfaceProps) {
  return (
    <div className={clsx(css.glass, css[variant], sheen && css.sheen, className)}>
      {children}
    </div>
  )
}
