import type { IconProps } from './icons/props.ts'

/**
 * SecScan RedTeam diamond mark, traced from the desktop icon artwork
 * (`apps/desktop/resources/icon.png`): a red shield frame on a dark navy
 * tile, blue crosshair centred in the frame. Fixed fills — the mark is
 * multi-color and cannot ride the monochrome `currentColor` path the
 * shield mark uses, so it keeps its own square geometry instead of
 * sharing {@link FISH_LOGO_VIEWBOX}.
 *
 * Render the diamond mark.
 * @param props.size - square edge in px (default 24; the mark is square, so height equals size).
 * @param props.className - extra class for layout placement.
 * @returns the mark svg (aria-hidden; pair with the wordmark for accessibility).
 */
export function DiamondLogo({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox="0 0 100 100"
      fill="none"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="94" height="94" rx="19" fill="#0e1628" />
      <path
        d={'M50 11.4L89.6 19.7V48L50 90.2L10.4 48V19.7Z'
          + 'M50 23.4L77 28V46.5L50 77.4L23 46.5V28Z'}
        fill="#d92344"
        fillRule="evenodd"
      />
      <g stroke="#38b2e8" strokeWidth="3.1">
        <circle cx="50" cy="47" r="10.5" fill="none" />
        <path d="M50 33.8V43.8M50 50.2V60.2M36.8 47H46.8M53.2 47H63.2" fill="none" />
      </g>
      <circle cx="50" cy="47" r="1.9" fill="#38b2e8" />
    </svg>
  )
}
