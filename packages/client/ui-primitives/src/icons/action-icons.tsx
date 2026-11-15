/**
 * Row action glyphs: chevron-up, close in its outline, fill, and circle forms,
 * copy, refresh, like and dislike weights, and share.
 */
import type { IconProps } from './props.ts'
import type { WeightedIconProps } from './base.ts'
import { ICON_MEDIUM_STROKE, ICON_REGULAR_STROKE } from './base.ts'

const IconTriangleRightFillArtwork = ({ size = 14, className, strokeWidth }: WeightedIconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={strokeWidth}>
    <path d="M5.5 4.5C5.5 4.40714 5.52586 4.31612 5.57467 4.23713C5.62349 4.15815 5.69334 4.09431 5.77639 4.05279C5.85945 4.01126 5.95242 3.99368 6.0449 4.00202C6.13738 4.01036 6.22572 4.04429 6.3 4.1L10.967 7.6C11.0291 7.64657 11.0795 7.70697 11.1142 7.77639C11.1489 7.84582 11.167 7.92238 11.167 8C11.167 8.07762 11.1489 8.15418 11.1142 8.22361C11.0795 8.29303 11.0291 8.35343 10.967 8.4L6.3 11.9C6.22572 11.9557 6.13738 11.9896 6.0449 11.998C5.95242 12.0063 5.85945 11.9887 5.77639 11.9472C5.69334 11.9057 5.62349 11.8419 5.57467 11.7629C5.52586 11.6839 5.5 11.5929 5.5 11.5V4.5Z" fill="currentColor" />
  </svg>
)

/** Regular IconTriangleRightFill artwork; its fill-only geometry is weight-independent. */
export const IconTriangleRightFillRegular = (props: IconProps) => (
  <IconTriangleRightFillArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconTriangleRightFill artwork; it matches Regular because the geometry is fill-only. */
export const IconTriangleRightFillMedium = (props: IconProps) => (
  <IconTriangleRightFillArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)

const IconChevronUpOutlineArtwork = ({ size = 14, className, strokeWidth }: WeightedIconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={strokeWidth}>
    <path d="M12 10L8.70711 6.70711C8.31658 6.31658 7.68342 6.31658 7.29289 6.70711L4 10" stroke="currentColor" />
  </svg>
)

/** Regular one-pixel IconChevronUpOutline artwork. */
export const IconChevronUpOutlineRegular = (props: IconProps) => (
  <IconChevronUpOutlineArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconChevronUpOutline artwork with a 1.3px stroke. */
export const IconChevronUpOutlineMedium = (props: IconProps) => (
  <IconChevronUpOutlineArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)

const IconCloseOutlineArtwork = ({ size = 16, className, strokeWidth }: WeightedIconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={strokeWidth}>
    <path d="M2.5 2.5L13.5 13.5" stroke="currentColor" />
    <path d="M13.5 2.5L2.5 13.5" stroke="currentColor" />
  </svg>
)

/** Regular one-pixel IconCloseOutline artwork. */
export const IconCloseOutlineRegular = (props: IconProps) => (
  <IconCloseOutlineArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconCloseOutline artwork with a 1.3px stroke. */
export const IconCloseOutlineMedium = (props: IconProps) => (
  <IconCloseOutlineArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)

const IconCloseFillArtwork = ({ size = 14, className, strokeWidth }: WeightedIconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={strokeWidth}>
    <path d="M3.5 3.5L12.5 12.5" stroke="currentColor" />
    <path d="M12.5 3.5L3.5 12.5" stroke="currentColor" />
  </svg>
)

/** Regular one-pixel IconCloseFill artwork. */
export const IconCloseFillRegular = (props: IconProps) => (
  <IconCloseFillArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconCloseFill artwork with a 1.3px stroke. */
export const IconCloseFillMedium = (props: IconProps) => (
  <IconCloseFillArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)

// A 7-unit disc with the cross knocked out of it (even-odd), so the cross
// takes the color of whatever sits behind the glyph.
const IconCloseCircleFillArtwork = ({ size = 16, className, strokeWidth }: WeightedIconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={strokeWidth}>
    <path fillRule="evenodd" clipRule="evenodd" d="M15 8A7 7 0 1 1 1 8A7 7 0 1 1 15 8ZM6.409 10.652L5.348 9.591L6.939 8L5.348 6.409L6.409 5.348L8 6.939L9.591 5.348L10.652 6.409L9.061 8L10.652 9.591L9.591 10.652L8 9.061Z" fill="currentColor" />
  </svg>
)

/** Regular IconCloseCircleFill artwork (cross knocked out of a filled disc); its fill-only geometry is weight-independent. */
export const IconCloseCircleFillRegular = (props: IconProps) => (
  <IconCloseCircleFillArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconCloseCircleFill artwork; it matches Regular because the geometry is fill-only. */
export const IconCloseCircleFillMedium = (props: IconProps) => (
  <IconCloseCircleFillArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)

const IconCopyOutlineArtwork = ({ size = 16, className, strokeWidth }: WeightedIconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={strokeWidth}>
    <rect x="1.52075" y="4.07373" width="10.3932" height="10.3932" rx="2" stroke="currentColor" />
    <path d="M11.9792 1.53296C13.36 1.53296 14.4792 2.65225 14.4792 4.03296V9.42847C14.4792 10.3756 13.9521 11.1987 13.1755 11.6228V10.3298C13.3652 10.0787 13.4792 9.7674 13.4792 9.42847V4.03296C13.4792 3.20453 12.8077 2.53296 11.9792 2.53296H6.58374C6.27966 2.53301 5.99684 2.6235 5.7605 2.77905H4.42358C4.85652 2.03463 5.66056 1.53304 6.58374 1.53296H11.9792Z" fill="currentColor" />
  </svg>
)

/** Regular one-pixel IconCopyOutline artwork. */
export const IconCopyOutlineRegular = (props: IconProps) => (
  <IconCopyOutlineArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconCopyOutline artwork with a 1.3px stroke. */
export const IconCopyOutlineMedium = (props: IconProps) => (
  <IconCopyOutlineArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)

const IconRefreshOutlineArtwork = ({ size = 16, className, strokeWidth }: WeightedIconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={strokeWidth}>
    <path d="M14.5001 8C14.5 9.28552 14.1188 10.5422 13.4045 11.611C12.6903 12.6799 11.6752 13.5129 10.4875 14.0049C9.29982 14.4968 7.99295 14.6255 6.73212 14.3747C5.4713 14.124 4.31314 13.505 3.4041 12.596C2.49514 11.687 1.87614 10.5288 1.62537 9.26798C1.37459 8.00716 1.50331 6.70028 1.99525 5.51261C2.48719 4.32494 3.32025 3.30981 4.3891 2.59557C5.45795 1.88134 6.71458 1.50008 8.0001 1.5C9.9001 1.5 11.7001 2.3 13.0001 3.6L14.5001 5.1" stroke="currentColor" />
    <path d="M14.4999 1.5V5.1H10.8999" stroke="currentColor" />
  </svg>
)

/** Regular one-pixel IconRefreshOutline artwork. */
export const IconRefreshOutlineRegular = (props: IconProps) => (
  <IconRefreshOutlineArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconRefreshOutline artwork with a 1.3px stroke. */
export const IconRefreshOutlineMedium = (props: IconProps) => (
  <IconRefreshOutlineArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)

const IconLikeOutlineArtwork = ({ size = 16, className, strokeWidth }: WeightedIconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={strokeWidth}>
    <path d="M13.537 8.12098L12.3983 12.8455C12.1818 13.7438 11.378 14.3769 10.454 14.3769L9.35595 14.3769H7.43799H5.16577C3.50892 14.3769 2.16577 13.0337 2.16577 11.3769V7.88668C2.16577 7.33439 2.61349 6.88668 3.16577 6.88668H4.02665C5.84943 6.88668 7.38083 3.28711 7.67689 2.54578C7.71259 2.45639 7.73501 2.36373 7.77922 2.27824C7.86506 2.11221 8.08228 1.87578 8.59039 2.07775C10.3291 2.76886 9.23144 6.04071 8.96955 6.75058C8.94502 6.81707 8.99495 6.88668 9.06581 6.88668H12.5648C13.2119 6.88668 13.6886 7.49192 13.537 8.12098Z" stroke="currentColor" />
  </svg>
)

/** Regular one-pixel IconLikeOutline artwork. */
export const IconLikeOutlineRegular = (props: IconProps) => (
  <IconLikeOutlineArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconLikeOutline artwork with a 1.3px stroke. */
export const IconLikeOutlineMedium = (props: IconProps) => (
  <IconLikeOutlineArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)

const IconLikeFillArtwork = ({ size = 16, className, strokeWidth }: WeightedIconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={strokeWidth}>
    <path d="M13.537 8.12098L12.3983 12.8455C12.1818 13.7438 11.378 14.3769 10.454 14.3769L9.35595 14.3769H7.43799H5.16577C3.50892 14.3769 2.16577 13.0337 2.16577 11.3769V7.88668C2.16577 7.33439 2.61349 6.88668 3.16577 6.88668H4.02665C5.84943 6.88668 7.38083 3.28711 7.67689 2.54578C7.71259 2.45639 7.73501 2.36373 7.77922 2.27824C7.86506 2.11221 8.08228 1.87578 8.59039 2.07775C10.3291 2.76886 9.23144 6.04071 8.96955 6.75058C8.94502 6.81707 8.99495 6.88668 9.06581 6.88668H12.5648C13.2119 6.88668 13.6886 7.49192 13.537 8.12098Z" fill="currentColor" stroke="currentColor" />
  </svg>
)

/** Regular one-pixel IconLikeFill artwork. */
export const IconLikeFillRegular = (props: IconProps) => (
  <IconLikeFillArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconLikeFill artwork with a 1.3px stroke. */
export const IconLikeFillMedium = (props: IconProps) => (
  <IconLikeFillArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)

const IconDislikeOutlineArtwork = ({ size = 16, className, strokeWidth }: WeightedIconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={strokeWidth}>
    <path d="M2.46302 8.06749L3.60171 3.34299C3.81822 2.44467 4.62196 1.81162 5.546 1.8116L6.64406 1.81158L8.56202 1.81158L10.8342 1.81158C12.4911 1.81158 13.8342 3.15473 13.8342 4.81158L13.8342 8.3018C13.8342 8.85408 13.3865 9.3018 12.8342 9.3018L11.9734 9.3018C10.1506 9.3018 8.61918 12.9014 8.32311 13.6427C8.28741 13.7321 8.26499 13.8247 8.22078 13.9102C8.13494 14.0763 7.91772 14.3127 7.40961 14.1107C5.67089 13.4196 6.76856 10.1478 7.03045 9.43789C7.05498 9.37141 7.00505 9.3018 6.93419 9.3018L3.43519 9.3018C2.78811 9.3018 2.31141 8.69656 2.46302 8.06749Z" stroke="currentColor" />
  </svg>
)

/** Regular one-pixel IconDislikeOutline artwork. */
export const IconDislikeOutlineRegular = (props: IconProps) => (
  <IconDislikeOutlineArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconDislikeOutline artwork with a 1.3px stroke. */
export const IconDislikeOutlineMedium = (props: IconProps) => (
  <IconDislikeOutlineArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)

const IconDislikeFillArtwork = ({ size = 16, className, strokeWidth }: WeightedIconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={strokeWidth}>
    <path d="M2.46302 8.06749L3.60171 3.34299C3.81822 2.44467 4.62196 1.81162 5.546 1.8116L6.64406 1.81158L8.56202 1.81158L10.8342 1.81158C12.4911 1.81158 13.8342 3.15473 13.8342 4.81158L13.8342 8.3018C13.8342 8.85408 13.3865 9.3018 12.8342 9.3018L11.9734 9.3018C10.1506 9.3018 8.61918 12.9014 8.32311 13.6427C8.28741 13.7321 8.26499 13.8247 8.22078 13.9102C8.13494 14.0763 7.91772 14.3127 7.40961 14.1107C5.67089 13.4196 6.76856 10.1478 7.03045 9.43789C7.05498 9.37141 7.00505 9.3018 6.93419 9.3018L3.43519 9.3018C2.78811 9.3018 2.31141 8.69656 2.46302 8.06749Z" fill="currentColor" stroke="currentColor" />
  </svg>
)

/** Regular one-pixel IconDislikeFill artwork. */
export const IconDislikeFillRegular = (props: IconProps) => (
  <IconDislikeFillArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconDislikeFill artwork with a 1.3px stroke. */
export const IconDislikeFillMedium = (props: IconProps) => (
  <IconDislikeFillArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)

const IconShareOutlineArtwork = ({ size = 16, className, strokeWidth }: WeightedIconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={strokeWidth}>
    <path d="M14.1256 7.58723C14.3483 7.81942 14.3482 8.18589 14.1254 8.41799L8.6646 14.1077C8.53985 14.2377 8.32031 14.1494 8.32031 13.9692L8.32035 10.2039C8.32035 10.1943 8.31534 10.1864 8.30592 10.1849C8.08306 10.148 5.30067 9.7729 1.50993 13.2904C1.49711 13.3023 1.47561 13.2943 1.4757 13.2768C1.49273 9.87168 3.42001 5.07166 8.29999 5.05835C8.31103 5.05832 8.32035 5.04937 8.32035 5.03832L8.32031 2.03109C8.32031 1.85088 8.53993 1.76259 8.66466 1.89266L14.1256 7.58723Z" stroke="currentColor" />
  </svg>
)

/** Regular one-pixel IconShareOutline artwork. */
export const IconShareOutlineRegular = (props: IconProps) => (
  <IconShareOutlineArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconShareOutline artwork with a 1.3px stroke. */
export const IconShareOutlineMedium = (props: IconProps) => (
  <IconShareOutlineArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)
