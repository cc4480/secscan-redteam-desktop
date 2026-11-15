/**
 * Application shell and navigation glyphs: new conversation, search, globe,
 * settings, panel, overflow, add, check, branch, and the chevron and triangle
 * arrows.
 */
import type { IconProps } from './props.ts'
import type { WeightedIconProps } from './base.ts'
import { ICON_MEDIUM_STROKE, ICON_REGULAR_STROKE } from './base.ts'
import { GlobeOutlineArtwork, NewChatOutlineArtwork } from './shared-artwork.tsx'

/** Regular one-pixel IconNewChatOutline artwork. */
export const IconNewChatOutlineRegular = (props: IconProps) => (
  <NewChatOutlineArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconNewChatOutline artwork with a 1.3px stroke. */
export const IconNewChatOutlineMedium = (props: IconProps) => (
  <NewChatOutlineArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)

const IconSearchOutlineArtwork = ({ size = 16, className, strokeWidth }: WeightedIconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={strokeWidth}>
    <path d="M6.58727 11.8586C9.55061 11.8586 11.9529 9.45637 11.9529 6.49304C11.9529 3.5297 9.55061 1.12744 6.58727 1.12744C3.62394 1.12744 1.22168 3.5297 1.22168 6.49304C1.22168 9.45637 3.62394 11.8586 6.58727 11.8586Z" stroke="currentColor" />
    <path d="M10.2991 10.3933L14.7783 14.8725" stroke="currentColor" />
  </svg>
)

/** Regular one-pixel IconSearchOutline artwork. */
export const IconSearchOutlineRegular = (props: IconProps) => (
  <IconSearchOutlineArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconSearchOutline artwork with a 1.3px stroke. */
export const IconSearchOutlineMedium = (props: IconProps) => (
  <IconSearchOutlineArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)

/** Regular one-pixel IconGlobeOutline artwork. */
export const IconGlobeOutlineRegular = (props: IconProps) => (
  <GlobeOutlineArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconGlobeOutline artwork with a 1.3px stroke. */
export const IconGlobeOutlineMedium = (props: IconProps) => (
  <GlobeOutlineArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)

const IconSettingsOutlineArtwork = ({ size = 16, className, strokeWidth }: WeightedIconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={strokeWidth}>
    <path d="M8 9.75012C8.9665 9.75012 9.75 8.96662 9.75 8.00012C9.75 7.03362 8.9665 6.25012 8 6.25012C7.0335 6.25012 6.25 7.03362 6.25 8.00012C6.25 8.96662 7.0335 9.75012 8 9.75012Z" stroke="currentColor" />
    <path d="M13.0107 7.79377C12.9505 7.89401 12.9205 7.94413 12.9205 7.99951C12.9205 8.0549 12.9505 8.10502 13.0106 8.20528L13.9849 9.83006C14.045 9.93029 14.0751 9.9804 14.0751 10.0358C14.0751 10.0911 14.045 10.1413 13.9849 10.2415L13.0037 11.8777C12.9468 11.9726 12.9184 12.0201 12.8725 12.0461C12.8267 12.072 12.7713 12.072 12.6607 12.072H10.6704C10.5598 12.072 10.5045 12.072 10.4586 12.098C10.4128 12.1239 10.3843 12.1714 10.3274 12.2662L9.33825 13.9142C9.28133 14.009 9.25287 14.0564 9.20703 14.0823C9.16118 14.1083 9.10588 14.1083 8.99529 14.1083H7.00486C6.89426 14.1083 6.83896 14.1083 6.79312 14.0823C6.74727 14.0564 6.71881 14.009 6.6619 13.9142L5.67273 12.2662C5.61581 12.1714 5.58735 12.1239 5.54151 12.098C5.49566 12.072 5.44036 12.072 5.32977 12.072H3.33945C3.2288 12.072 3.17347 12.072 3.12761 12.0461C3.08176 12.0201 3.0533 11.9726 2.9964 11.8777L2.0152 10.2415C1.9551 10.1413 1.92505 10.0911 1.92505 10.0358C1.92505 9.9804 1.9551 9.93029 2.0152 9.83006L2.98951 8.20528C3.04963 8.10502 3.07969 8.0549 3.07969 7.99951C3.07968 7.94413 3.04961 7.89401 2.98946 7.79377L2.01529 6.17011C1.95514 6.06987 1.92507 6.01975 1.92507 5.96437C1.92506 5.90899 1.95512 5.85886 2.01524 5.7586L2.9964 4.1224C3.0533 4.0275 3.08176 3.98005 3.12761 3.95408C3.17347 3.92811 3.2288 3.92811 3.33945 3.92811H5.32977C5.44036 3.92811 5.49566 3.92811 5.54151 3.90216C5.58735 3.87621 5.61581 3.82879 5.67273 3.73397L6.6619 2.08599C6.71881 1.99116 6.74727 1.94375 6.79312 1.9178C6.83896 1.89185 6.89426 1.89185 7.00486 1.89185H8.99529C9.10588 1.89185 9.16118 1.89185 9.20703 1.9178C9.25287 1.94375 9.28133 1.99116 9.33825 2.08599L10.3274 3.73397C10.3843 3.82879 10.4128 3.87621 10.4586 3.90216C10.5045 3.92811 10.5598 3.92811 10.6704 3.92811H12.6607C12.7713 3.92811 12.8267 3.92811 12.8725 3.95408C12.9184 3.98005 12.9468 4.0275 13.0037 4.1224L13.9849 5.7586C14.045 5.85886 14.0751 5.90899 14.0751 5.96437C14.0751 6.01975 14.045 6.06987 13.9849 6.17011L13.0107 7.79377Z" stroke="currentColor" strokeMiterlimit="10" />
  </svg>
)

/** Regular one-pixel IconSettingsOutline artwork. */
export const IconSettingsOutlineRegular = (props: IconProps) => (
  <IconSettingsOutlineArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconSettingsOutline artwork with a 1.3px stroke. */
export const IconSettingsOutlineMedium = (props: IconProps) => (
  <IconSettingsOutlineArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)

const IconPanelLeftOutlineArtwork = ({ size = 16, className, strokeWidth }: WeightedIconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={strokeWidth}>
    <path d="M13.5 1.5H2.5C1.94772 1.5 1.5 1.94772 1.5 2.5V13.5C1.5 14.0523 1.94772 14.5 2.5 14.5H13.5C14.0523 14.5 14.5 14.0523 14.5 13.5V2.5C14.5 1.94772 14.0523 1.5 13.5 1.5Z" stroke="currentColor" />
    <path d="M5.5 1.5V14.5" stroke="currentColor" />
  </svg>
)

/** Regular one-pixel IconPanelLeftOutline artwork. */
export const IconPanelLeftOutlineRegular = (props: IconProps) => (
  <IconPanelLeftOutlineArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconPanelLeftOutline artwork with a 1.3px stroke. */
export const IconPanelLeftOutlineMedium = (props: IconProps) => (
  <IconPanelLeftOutlineArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)

const IconEllipsisOutlineArtwork = ({ size = 16, className, strokeWidth }: WeightedIconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={strokeWidth}>
    <path d="M3 9C3.55228 9 4 8.55228 4 8C4 7.44772 3.55228 7 3 7C2.44772 7 2 7.44772 2 8C2 8.55228 2.44772 9 3 9Z" fill="currentColor" />
    <path d="M8 9C8.55228 9 9 8.55228 9 8C9 7.44772 8.55228 7 8 7C7.44772 7 7 7.44772 7 8C7 8.55228 7.44772 9 8 9Z" fill="currentColor" />
    <path d="M13 9C13.5523 9 14 8.55228 14 8C14 7.44772 13.5523 7 13 7C12.4477 7 12 7.44772 12 8C12 8.55228 12.4477 9 13 9Z" fill="currentColor" />
  </svg>
)

/** Regular IconEllipsisOutline artwork; its fill-only geometry is weight-independent. */
export const IconEllipsisOutlineRegular = (props: IconProps) => (
  <IconEllipsisOutlineArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconEllipsisOutline artwork; it matches Regular because the geometry is fill-only. */
export const IconEllipsisOutlineMedium = (props: IconProps) => (
  <IconEllipsisOutlineArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)

const IconPlusOutlineArtwork = ({ size = 16, className, strokeWidth }: WeightedIconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={strokeWidth}>
    <path d="M8 2V14" stroke="currentColor" />
    <path d="M2 8H14" stroke="currentColor" />
  </svg>
)

/** Regular one-pixel IconPlusOutline artwork. */
export const IconPlusOutlineRegular = (props: IconProps) => (
  <IconPlusOutlineArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconPlusOutline artwork with a 1.3px stroke. */
export const IconPlusOutlineMedium = (props: IconProps) => (
  <IconPlusOutlineArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)

const IconCheckOutlineArtwork = ({ size = 16, className, strokeWidth }: WeightedIconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={strokeWidth}>
    <path d="M2.25 8.5L5.49732 11.7473C5.90519 12.1552 6.57263 12.1344 6.95426 11.7018L13.75 4" stroke="currentColor" />
  </svg>
)

/** Regular one-pixel IconCheckOutline artwork. */
export const IconCheckOutlineRegular = (props: IconProps) => (
  <IconCheckOutlineArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconCheckOutline artwork with a 1.3px stroke. */
export const IconCheckOutlineMedium = (props: IconProps) => (
  <IconCheckOutlineArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)

const IconBranchOutlineArtwork = ({ size = 16, className, strokeWidth }: WeightedIconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={strokeWidth}>
    <path d="M1.01503 8.0001L5.6964 8.0001C6.41913 8.0001 6.78049 8.0001 7.12115 7.91951C7.4232 7.84804 7.71233 7.73014 7.97821 7.57C8.27809 7.38939 8.5364 7.13669 9.05303 6.63129L11.3281 4.40564" stroke="currentColor" />
    <path d="M1.01221 7.9999L5.6964 7.9999C6.41913 7.9999 6.78049 7.9999 7.12115 8.08049C7.4232 8.15196 7.71233 8.26986 7.97821 8.43C8.27809 8.61061 8.5364 8.86331 9.05303 9.36871L11.3281 11.5944" stroke="currentColor" />
    <circle cx="12.4502" cy="3.3079" r="1.56962" stroke="currentColor" />
    <circle cx="12.4502" cy="12.6921" r="1.56962" stroke="currentColor" />
  </svg>
)

/** Regular one-pixel IconBranchOutline artwork. */
export const IconBranchOutlineRegular = (props: IconProps) => (
  <IconBranchOutlineArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconBranchOutline artwork with a 1.3px stroke. */
export const IconBranchOutlineMedium = (props: IconProps) => (
  <IconBranchOutlineArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)

const IconChevronDownOutlineArtwork = ({ size = 14, className, strokeWidth }: WeightedIconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={strokeWidth}>
    <path d="M4 6L7.29289 9.29289C7.68342 9.68342 8.31658 9.68342 8.70711 9.29289L12 6" stroke="currentColor" />
  </svg>
)

/** Regular one-pixel IconChevronDownOutline artwork. */
export const IconChevronDownOutlineRegular = (props: IconProps) => (
  <IconChevronDownOutlineArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconChevronDownOutline artwork with a 1.3px stroke. */
export const IconChevronDownOutlineMedium = (props: IconProps) => (
  <IconChevronDownOutlineArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)

const IconChevronLeftOutlineArtwork = ({ size = 14, className, strokeWidth }: WeightedIconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={strokeWidth}>
    <path d="M10 4L6.70711 7.29289C6.31658 7.68342 6.31658 8.31658 6.70711 8.70711L10 12" stroke="currentColor" />
  </svg>
)

/** Regular one-pixel IconChevronLeftOutline artwork. */
export const IconChevronLeftOutlineRegular = (props: IconProps) => (
  <IconChevronLeftOutlineArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconChevronLeftOutline artwork with a 1.3px stroke. */
export const IconChevronLeftOutlineMedium = (props: IconProps) => (
  <IconChevronLeftOutlineArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)

const IconChevronRightOutlineArtwork = ({ size = 14, className, strokeWidth }: WeightedIconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={strokeWidth}>
    <path d="M6 12L9.29289 8.70711C9.68342 8.31658 9.68342 7.68342 9.29289 7.29289L6 4" stroke="currentColor" />
  </svg>
)

/** Regular one-pixel IconChevronRightOutline artwork. */
export const IconChevronRightOutlineRegular = (props: IconProps) => (
  <IconChevronRightOutlineArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconChevronRightOutline artwork with a 1.3px stroke. */
export const IconChevronRightOutlineMedium = (props: IconProps) => (
  <IconChevronRightOutlineArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)
