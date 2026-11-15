/**
 * Control glyphs: archive check, sliders, and microphone.
 */
import type { IconProps } from './props.ts'
import type { WeightedIconProps } from './base.ts'
import { ICON_MEDIUM_STROKE, ICON_REGULAR_STROKE } from './base.ts'

const IconArchiveCheckOutlineArtwork = ({ size = 16, className, strokeWidth }: WeightedIconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none"
    stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" strokeWidth={strokeWidth}>
    <rect x="1.9" y="2.1" width="12.2" height="3.4" rx="1.1" />
    <path d="M2.95 5.7v4.8a2.9 2.9 0 0 0 2.9 2.9h4.3a2.9 2.9 0 0 0 2.9-2.9V5.7" />
    <path d="m6 9.35 1.4 1.4 2.6-2.6" />
  </svg>
)

/** Regular one-pixel IconArchiveCheckOutline artwork. */
export const IconArchiveCheckOutlineRegular = (props: IconProps) => (
  <IconArchiveCheckOutlineArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconArchiveCheckOutline artwork with a 1.3px stroke. */
export const IconArchiveCheckOutlineMedium = (props: IconProps) => (
  <IconArchiveCheckOutlineArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)

const IconSlidersTwoOutlineArtwork = ({ size = 16, className, strokeWidth }: WeightedIconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none"
    stroke="currentColor" strokeLinecap="round" aria-hidden="true" strokeWidth={strokeWidth}>
    <path d="M2.3 5h5.85M12.05 5h1.65" />
    <circle cx="9.95" cy="5" r="1.45" />
    <path d="M2.3 11h1.65M7.85 11h5.85" />
    <circle cx="5.75" cy="11" r="1.45" />
  </svg>
)

/** Regular one-pixel IconSlidersTwoOutline artwork. */
export const IconSlidersTwoOutlineRegular = (props: IconProps) => (
  <IconSlidersTwoOutlineArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconSlidersTwoOutline artwork with a 1.3px stroke. */
export const IconSlidersTwoOutlineMedium = (props: IconProps) => (
  <IconSlidersTwoOutlineArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)

const IconMicrophoneOutlineArtwork = ({ size = 16, className, strokeWidth }: WeightedIconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth={strokeWidth} aria-hidden="true">
    <rect x={4.5 + strokeWidth / 2} y={1 + strokeWidth / 2} width={7 - strokeWidth} height={10 - strokeWidth} rx={(7 - strokeWidth) / 2} />
    <path d="M2.35 8.675C3.075 11.3 5.2 13.125 8 13.125C10.8 13.125 12.925 11.3 13.65 8.675M8 13.125V15" />
  </svg>
)

/** Microphone with uniform one-pixel strokes. */
export const IconMicrophoneOutlineRegular = (props: IconProps) => (
  <IconMicrophoneOutlineArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Microphone with uniform 1.3px strokes. */
export const IconMicrophoneOutlineMedium = (props: IconProps) => (
  <IconMicrophoneOutlineArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)
