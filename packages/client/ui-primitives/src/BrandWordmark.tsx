import { FISH_LOGO_PATH, FISH_LOGO_VIEWBOX } from './FishLogo.tsx'
import type { IconProps } from './icons/props.ts'

/** Display options for the product brand wordmark. */
export interface BrandWordmarkProps extends IconProps {
  /** Whether to include the leading product mark; defaults to true. */
  includeMark?: boolean | undefined
}

/**
 * Render the product wordmark.
 * @param props.size - height in px (default 24; width follows the selected artwork).
 * @param props.className - extra class for layout placement.
 * @param props.includeMark - whether to include the leading product mark.
 * @returns the wordmark svg (aria-hidden decorative brand art).
 */
export function BrandWordmark({ size = 24, className, includeMark = true }: BrandWordmarkProps) {
  const width = includeMark ? 182 : 156
  // The mark keeps its native 23.16x17.04 box, centred in the 24-unit band.
  const markOffsetY = (24 - FISH_LOGO_VIEWBOX.height) / 2
  return (
    <svg
      width={(size * width) / 24}
      height={size}
      className={className}
      viewBox={includeMark ? '0 0 182 24' : '26 0 156 24'}
      fill="none"
      aria-hidden="true"
    >
      {includeMark && (
        <path
          d={FISH_LOGO_PATH}
          fill="currentColor"
          fillRule="evenodd"
          transform={`translate(0 ${markOffsetY})`}
        />
      )}
      <text
        x="26"
        y="17.6"
        fill="currentColor"
        fontFamily="Montserrat, system-ui, -apple-system, 'Segoe UI', sans-serif"
        fontSize="15.5"
        fontWeight="700"
        letterSpacing="-0.3"
      >
        SecScan
        <tspan fontWeight="500" dx="3">RedTeam</tspan>
      </text>
    </svg>
  )
}
