/**
 * Content glyphs: sparkle, inspect, skill, question, info, plugin pinwheel,
 * alarm clock, archive, and the wrap modes.
 */
import type { IconProps } from './props.ts'
import type { WeightedIconProps } from './base.ts'
import { ICON_MEDIUM_STROKE, ICON_REGULAR_STROKE } from './base.ts'
import { CodeBracketsArtwork } from './shared-artwork.tsx'

const IconSparkleArtwork = ({ size = 16, className, strokeWidth }: WeightedIconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={strokeWidth}>
    <path d="M5.875 3C5.875 6.33333 7.54167 8 10.875 8C7.54167 8 5.875 9.66667 5.875 13C5.875 9.66667 4.20833 8 0.875 8C4.20833 8 5.875 6.33333 5.875 3Z" stroke="currentColor" />
    <path d="M12.375 1.55823C12.375 3.39156 13.2917 4.30823 15.125 4.30823C13.2917 4.30823 12.375 5.22489 12.375 7.05823C12.375 5.22489 11.4583 4.30823 9.625 4.30823C11.4583 4.30823 12.375 3.39156 12.375 1.55823Z" stroke="currentColor" />
    <path d="M12.375 10.4418C12.375 11.7751 13.0417 12.4418 14.375 12.4418C13.0417 12.4418 12.375 13.1084 12.375 14.4418C12.375 13.1084 11.7083 12.4418 10.375 12.4418C11.7083 12.4418 12.375 11.7751 12.375 10.4418Z" stroke="currentColor" />
  </svg>
)

/** Regular one-pixel IconSparkle artwork. */
export const IconSparkleRegular = (props: IconProps) => (
  <IconSparkleArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconSparkle artwork with a 1.3px stroke. */
export const IconSparkleMedium = (props: IconProps) => (
  <IconSparkleArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)

/** Regular one-pixel IconInspectOutline artwork. */
export const IconInspectOutlineRegular = (props: IconProps) => (
  <CodeBracketsArtwork {...props} size={props.size ?? 12} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconInspectOutline artwork with a 1.3px stroke. */
export const IconInspectOutlineMedium = (props: IconProps) => (
  <CodeBracketsArtwork {...props} size={props.size ?? 12} strokeWidth={ICON_MEDIUM_STROKE} />
)

const IconSkillOutlineArtwork = ({ size = 16, className, strokeWidth }: WeightedIconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 17 17" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={strokeWidth}>
    <path d="M4.57788 5.77124H10.7029" stroke="currentColor" />
    <path d="M4.57788 8.89819H7.91879" stroke="currentColor" />
    <path d="M12.1404 1.19446C12.9442 1.19446 13.6404 1.81999 13.6404 2.64465V8.89856H12.6404V2.64465C12.6404 2.42015 12.4411 2.19446 12.1404 2.19446H3.14038C2.83968 2.19446 2.64038 2.42015 2.64038 2.64465V13.0929C2.64082 13.3172 2.84001 13.5421 3.14038 13.5421H8.88159V14.5421H3.14038C2.33675 14.5421 1.6408 13.9172 1.64038 13.0929V2.64465C1.64038 1.81999 2.33651 1.19446 3.14038 1.19446H12.1404Z" fill="currentColor" />
    <path d="M12.0051 15.1056C12.0051 13.6395 10.8166 12.451 9.35059 12.451C10.8166 12.451 12.0051 11.2626 12.0051 9.79651C12.0051 11.2626 13.1936 12.451 14.6597 12.451C13.1936 12.451 12.0051 13.6395 12.0051 15.1056Z" stroke="currentColor" />
  </svg>
)

/** Regular one-pixel IconSkillOutline artwork. */
export const IconSkillOutlineRegular = (props: IconProps) => (
  <IconSkillOutlineArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconSkillOutline artwork with a 1.3px stroke. */
export const IconSkillOutlineMedium = (props: IconProps) => (
  <IconSkillOutlineArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)

const IconQuestionOutlineArtwork = ({ size = 14, className, strokeWidth }: WeightedIconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={strokeWidth}>
    <path d="M8 14.5C11.5899 14.5 14.5 11.5899 14.5 8C14.5 4.41015 11.5899 1.5 8 1.5C4.41015 1.5 1.5 4.41015 1.5 8C1.5 11.5899 4.41015 14.5 8 14.5Z" stroke="currentColor" />
    <path d="M5.75 6.69646C5.75 6.29865 5.88196 5.90976 6.12919 5.57899C6.37643 5.24821 6.72783 4.99041 7.13896 4.83817C7.5501 4.68593 8.0025 4.6461 8.43895 4.72371C8.87541 4.80132 9.27632 4.99289 9.59099 5.27419C9.90566 5.55549 10.12 5.91388 10.2068 6.30406C10.2936 6.69423 10.249 7.09866 10.0787 7.4662C9.90843 7.83373 9.62004 8.14787 9.25003 8.36889C9.19476 8.4019 9.13803 8.43262 9.08004 8.46099C8.52566 8.73217 8 9.20817 8 9.82532" stroke="currentColor" />
    <path d="M8 10.7416V11.7416" stroke="currentColor" />
  </svg>
)

/** Regular one-pixel IconQuestionOutline artwork. */
export const IconQuestionOutlineRegular = (props: IconProps) => (
  <IconQuestionOutlineArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconQuestionOutline artwork with a 1.3px stroke. */
export const IconQuestionOutlineMedium = (props: IconProps) => (
  <IconQuestionOutlineArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)

const IconInfoOutlineArtwork = ({ size = 14, className, strokeWidth }: WeightedIconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={strokeWidth}>
    <path
      d="M12.5757 7.00012C12.5757 3.92085 10.0794 1.42463 7.00012 1.42456C3.9208 1.42456 1.42456 3.9208 1.42456 7.00012C1.42463 10.0794 3.92085 12.5757 7.00012 12.5757C10.0793 12.5756 12.5756 10.0793 12.5757 7.00012ZM13.8002 7.00012C13.8001 10.7559 10.7559 13.8001 7.00012 13.8002C3.2443 13.8002 0.199291 10.7559 0.199219 7.00012C0.199219 3.24426 3.24426 0.199219 7.00012 0.199219C10.7559 0.199291 13.8002 3.2443 13.8002 7.00012Z"
      fill="currentColor"
    />
    <path d="M7.6127 3.18921V4.55986H6.38735V3.18921H7.6127Z" fill="currentColor" />
    <path d="M7.6127 5.68921V10.8109H6.38735V5.68921H7.6127Z" fill="currentColor" />
  </svg>
)

/** Regular IconInfoOutline artwork; its fill-only geometry is weight-independent. */
export const IconInfoOutlineRegular = (props: IconProps) => (
  <IconInfoOutlineArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconInfoOutline artwork; its fill-only geometry is weight-independent. */
export const IconInfoOutlineMedium = (props: IconProps) => (
  <IconInfoOutlineArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)

const IconPluginPinwheelOutlineArtwork = ({ size = 16, className, strokeWidth }: WeightedIconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={strokeWidth}>
    <path d="M7.84457 5.06199C11.6605 4.93876 14.7962 6.14848 14.8484 7.76397C14.8875 8.97461 13.1838 10.0696 10.7215 10.5942" stroke="currentColor" />
    <path d="M5.12742 8.07731C5.00419 4.26138 6.21391 1.12568 7.8294 1.07351C9.04004 1.03441 10.135 2.73808 10.6596 5.20037" stroke="currentColor" />
    <path d="M8.02457 10.6802C4.20865 10.8034 1.07294 9.5937 1.02077 7.97821C0.981678 6.76758 2.68535 5.67262 5.14763 5.14798" stroke="currentColor" />
    <path d="M10.7476 7.89535C10.8708 11.7113 9.66109 14.847 8.0456 14.8991C6.83496 14.9382 5.74 13.2346 5.21536 10.7723" stroke="currentColor" />
  </svg>
)

/** Regular one-pixel plugin pinwheel artwork. */
export const IconPluginPinwheelOutlineRegular = (props: IconProps) => (
  <IconPluginPinwheelOutlineArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium plugin pinwheel artwork with a 1.3px stroke. */
export const IconPluginPinwheelOutlineMedium = (props: IconProps) => (
  <IconPluginPinwheelOutlineArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)

const IconAlarmClockOutlineArtwork = ({ size = 16, className, strokeWidth }: WeightedIconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 17 17" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={strokeWidth}>
    <path d="M4.09372 11.9895L3.11865 14.0387" stroke="currentColor" />
    <path d="M12.1392 11.9895L13.1143 14.0387" stroke="currentColor" />
    <path d="M8.11646 4.78442V8.03442L10.6165 9.53442" stroke="currentColor" />
    <path d="M8.11646 13.4094C11.154 13.4094 13.6165 10.947 13.6165 7.90942C13.6165 4.87186 11.154 2.40942 8.11646 2.40942C5.07889 2.40942 2.61646 4.87186 2.61646 7.90942C2.61646 10.947 5.07889 13.4094 8.11646 13.4094Z" stroke="currentColor" />
    <path d="M1.75952 4.74323C2.30657 3.65639 3.12646 2.73047 4.12926 2.05542" stroke="currentColor" />
    <path d="M14.3345 4.74323C13.7874 3.65639 12.9675 2.73047 11.9647 2.05542" stroke="currentColor" />
  </svg>
)

/** Regular one-pixel IconAlarmClockOutline artwork. */
export const IconAlarmClockOutlineRegular = (props: IconProps) => (
  <IconAlarmClockOutlineArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconAlarmClockOutline artwork with a 1.3px stroke. */
export const IconAlarmClockOutlineMedium = (props: IconProps) => (
  <IconAlarmClockOutlineArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)

const IconArchiveOutlineArtwork = ({ size = 20, className, strokeWidth }: WeightedIconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={strokeWidth}>
    <path d="M13.5 2.5H2.5C1.94772 2.5 1.5 2.94772 1.5 3.5V4.5C1.5 5.05228 1.94772 5.5 2.5 5.5H13.5C14.0523 5.5 14.5 5.05228 14.5 4.5V3.5C14.5 2.94772 14.0523 2.5 13.5 2.5Z" stroke="currentColor" />
    <path d="M2.5 5.5V13.5C2.5 13.7652 2.60536 14.0196 2.79289 14.2071C2.98043 14.3946 3.23478 14.5 3.5 14.5H12.5C12.7652 14.5 13.0196 14.3946 13.2071 14.2071C13.3946 14.0196 13.5 13.7652 13.5 13.5V5.5" stroke="currentColor" />
    <path d="M6.5 9.5H9.5" stroke="currentColor" />
  </svg>
)

/** Regular one-pixel IconArchiveOutline artwork. */
export const IconArchiveOutlineRegular = (props: IconProps) => (
  <IconArchiveOutlineArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconArchiveOutline artwork with a 1.3px stroke. */
export const IconArchiveOutlineMedium = (props: IconProps) => (
  <IconArchiveOutlineArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)

const IconWrapLinesOutlineArtwork = ({ size = 16, className, strokeWidth }: WeightedIconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={strokeWidth}>
    <path d="M2.3457 3.19299H13.6541" stroke="currentColor" />
    <path d="M2.3457 7.46497H9.19332" stroke="currentColor" />
    <path d="M2.3457 11.7369H6.4849" stroke="currentColor" />
    <path d="M9.1936 7.46497H11.5183C12.6981 7.46497 13.6544 8.42132 13.6544 9.60103C13.6544 10.7808 12.6981 11.7371 11.5183 11.7371H9.1936" stroke="currentColor" />
    <path d="M10.9505 9.7677L9.12262 11.5956C9.04452 11.6737 9.04452 11.8003 9.12262 11.8784L10.9505 13.7063" stroke="currentColor" />
  </svg>
)

/** Regular one-pixel IconWrapLinesOutline artwork. */
export const IconWrapLinesOutlineRegular = (props: IconProps) => (
  <IconWrapLinesOutlineArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconWrapLinesOutline artwork with a 1.3px stroke. */
export const IconWrapLinesOutlineMedium = (props: IconProps) => (
  <IconWrapLinesOutlineArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)

const IconNowrapFillArtwork = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M2 15H1V1H2V15Z" fill="currentColor" />
    <path d="M12.3535 7.64645C12.5487 7.84171 12.5487 8.15829 12.3535 8.35355L9.85352 10.8535L9.14648 10.1465L10.793 8.5H3.5V7.5H10.793L9.14648 5.85352L9.85352 5.14648L12.3535 7.64645Z" fill="currentColor" />
    <path d="M15 15H14V1H15V15Z" fill="currentColor" />
  </svg>
)

/** Regular IconNowrapFill artwork; fill-only weights render identically. */
export const IconNowrapFillRegular = (props: IconProps) => <IconNowrapFillArtwork {...props} />

/** Medium IconNowrapFill artwork; fill-only weights render identically. */
export const IconNowrapFillMedium = (props: IconProps) => <IconNowrapFillArtwork {...props} />

const IconWrapFillArtwork = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M10.9999 8C10.9999 6.89543 10.1046 6 9 6H4.5V5H9C10.6568 5 11.9999 6.34315 11.9999 8C11.9999 9.65685 10.6568 11 9 11H6.20703L6.85351 11.6465L6.14648 12.3535L4.64652 10.8536C4.45126 10.6583 4.45126 10.3417 4.64652 10.1464L6.14648 8.64648L6.85351 9.35352L6.20703 10H9C10.1046 10 10.9999 9.10457 10.9999 8Z" fill="currentColor" />
    <path d="M2 15H1V1H2V15Z" fill="currentColor" />
    <path d="M15 15H14V1H15V15Z" fill="currentColor" />
  </svg>
)

/** Regular IconWrapFill artwork; fill-only weights render identically. */
export const IconWrapFillRegular = (props: IconProps) => <IconWrapFillArtwork {...props} />

/** Medium IconWrapFill artwork; fill-only weights render identically. */
export const IconWrapFillMedium = (props: IconProps) => <IconWrapFillArtwork {...props} />
