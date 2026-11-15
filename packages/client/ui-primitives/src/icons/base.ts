/**
 * Shared icon primitives: the weighted-artwork props, the two stroke
 * weights, and the shield contour composite icons reuse.
 */
import type { IconProps } from './props.ts'

export interface WeightedIconProps extends IconProps {
  strokeWidth: number
}

/** Shared shield contour used by composite icons outside this module. */
export const SHIELD_OUTLINE_PATH = 'M6.80132 2.14853C7.70663 1.80917 8.70422 1.80919 9.60952 2.14859L14.1296 3.84317V7.11961C14.1296 11.6089 10.7615 13.5975 8.20543 14.5779C5.64931 13.5975 2.28052 11.6089 2.28052 7.11961V3.84317L6.80132 2.14853Z'

/** Regular stroke width used by the product icon set. */
export const ICON_REGULAR_STROKE = 1

/** Medium stroke width used by emphasized product icons. */
export const ICON_MEDIUM_STROKE = 1.3
