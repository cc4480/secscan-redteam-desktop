import type { IconProps } from './icons/props.ts'

/**
 * Native viewBox of {@link FISH_LOGO_PATH} (width and height in user units).
 * Unchanged from the artwork it replaces, so every consumer's aspect ratio and
 * layout slot stays exactly as it was.
 */
export const FISH_LOGO_VIEWBOX = { width: 23.16, height: 17.04 }

/**
 * Legacy monochrome shield-with-check glyph. This is NOT the SecScan
 * RedTeam product mark — the product mark is the multi-color diamond
 * rendered by `DiamondLogo`. This glyph is retained only so the exported
 * name keeps working for any out-of-tree consumer; no client surface
 * renders it as the brand mark.
 *
 * One path element, two subpaths, cut out with the even-odd fill rule.
 */
export const FISH_LOGO_PATH =
  'M3.6 0.7H19.56V8C19.56 12.3 16.2 15.2 11.58 16.35C6.96 15.2 3.6 12.3 3.6 8V0.7Z'
  + 'M8.6 8.4L7.4 9.6L10.5 12.6L15.6 7.3L14.4 6.1L10.5 10.1Z'

/**
 * Render the legacy shield glyph (see {@link FISH_LOGO_PATH} — not the
 * product mark; use `DiamondLogo` for brand surfaces).
 * @param props.size - width in px (default 24; height keeps the 23.16:17.04 ratio).
 * @param props.className - extra class for layout placement.
 * @returns the glyph svg (aria-hidden).
 */
export function FishLogo({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={(size * FISH_LOGO_VIEWBOX.height) / FISH_LOGO_VIEWBOX.width}
      className={className}
      viewBox={`0 0 ${FISH_LOGO_VIEWBOX.width} ${FISH_LOGO_VIEWBOX.height}`}
      fill="none"
      aria-hidden="true"
    >
      <path d={FISH_LOGO_PATH} fill="currentColor" fillRule="evenodd" />
    </svg>
  )
}
