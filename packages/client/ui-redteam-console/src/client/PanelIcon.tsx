/**
 * The Engagements panel's rail icon: the SecScan diamond with its
 * crosshair, drawn in the current color at the rail's size.
 */
import type { ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * The icon as the sidebar's panel list shows it.
 * @param props - the rail's runtime props (the glyph size).
 * @returns the diamond-crosshair glyph.
 */
export function PanelIcon({ size }: PropsRuntime<'sidebar.panellist'>): ReactNode {
  const px = size ?? 18
  return (
    <svg width={px} height={px} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2.5 21.5 12 12 21.5 2.5 12Z"
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
      />
      <circle cx="12" cy="12" r="2.2" fill="currentColor" />
      <path d="M12 6.5v3M12 14.5v3M6.5 12h3M14.5 12h3" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}
