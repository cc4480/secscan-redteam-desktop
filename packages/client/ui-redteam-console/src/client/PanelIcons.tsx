/**
 * Rail icons for the Phase 3 panels, drawn in the current color at the
 * rail's size: a flask for Foundry, a grid for the Arsenal, a document
 * for Reports, a shield for Scope & Safety.
 */
import type { ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

type IconProps = PropsRuntime<'sidebar.panellist'>

function frame(size: number | undefined, children: ReactNode): ReactNode {
  const px = size ?? 18
  return (
    <svg width={px} height={px} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {children}
    </svg>
  )
}

/**
 * The Foundry panel's icon (a flask).
 * @param props - the rail's runtime props.
 * @returns the flask glyph.
 */
export function FoundryIcon({ size }: IconProps): ReactNode {
  return frame(size, (
    <>
      <path d="M10 3h4M10 3v5L4.5 18a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 8V3" stroke="currentColor" strokeWidth="1.6" />
      <path d="M7.5 14h9" stroke="currentColor" strokeWidth="1.6" />
    </>
  ))
}

/**
 * The Arsenal panel's icon (a grid of ordnance squares).
 * @param props - the rail's runtime props.
 * @returns the grid glyph.
 */
export function ArsenalIcon({ size }: IconProps): ReactNode {
  return frame(size, (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
    </>
  ))
}

/**
 * The Reports panel's icon (a document).
 * @param props - the rail's runtime props.
 * @returns the document glyph.
 */
export function ReportsIcon({ size }: IconProps): ReactNode {
  return frame(size, (
    <>
      <path d="M6 3.5h8L19 8v12a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 20V5A1.5 1.5 0 0 1 6 3.5Z" stroke="currentColor" strokeWidth="1.6" />
      <path d="M13.5 3.5V8H19M8.5 12.5h7M8.5 16h7" stroke="currentColor" strokeWidth="1.6" />
    </>
  ))
}

/**
 * The Scope & Safety panel's icon (a shield).
 * @param props - the rail's runtime props.
 * @returns the shield glyph.
 */
export function ScopeIcon({ size }: IconProps): ReactNode {
  return frame(size, (
    <>
      <path d="M12 3 5 5.8v5.4c0 4.6 3 7.7 7 9.3 4-1.6 7-4.7 7-9.3V5.8Z" stroke="currentColor" strokeWidth="1.6" />
      <path d="m9 11.6 2.2 2.2L15.4 9.6" stroke="currentColor" strokeWidth="1.6" />
    </>
  ))
}
