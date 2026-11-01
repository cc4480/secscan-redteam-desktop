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
        // The leading mark is the SecScan RedTeam diamond: the DiamondLogo
        // artwork (100-unit square, official fixed fills) scaled into the
        // 24-unit band. It never rides the monochrome shield glyph.
        <g transform="scale(0.24)">
          <rect x="3" y="3" width="94" height="94" rx="19" fill="#0B1120" />
          <path
            d={'M50 11.4L89.6 19.7V48L50 90.2L10.4 48V19.7Z'
              + 'M50 23.4L77 28V46.5L50 77.4L23 46.5V28Z'}
            fill="#CF2B4D"
            fillRule="evenodd"
          />
          <g stroke="#38BDF8" strokeWidth="3.1">
            <circle cx="50" cy="47" r="10.5" fill="none" />
            <path d="M50 33.8V43.8M50 50.2V60.2M36.8 47H46.8M53.2 47H63.2" fill="none" />
          </g>
          <circle cx="50" cy="47" r="1.9" fill="#38BDF8" />
        </g>
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
