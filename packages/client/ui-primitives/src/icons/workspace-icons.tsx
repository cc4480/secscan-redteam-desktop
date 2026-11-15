/**
 * Workspace glyphs: fullscreen, code, Cordis plugin, API, personalization,
 * project add, open and closed folders, tree corner, and the light theme.
 */
import type { IconProps } from './props.ts'
import type { WeightedIconProps } from './base.ts'
import { ICON_MEDIUM_STROKE, ICON_REGULAR_STROKE } from './base.ts'
import { FolderCloseArtwork } from './shared-artwork.tsx'

const IconFullscreenOutlineArtwork = ({ size = 16, className, strokeWidth }: WeightedIconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={strokeWidth}>
    <path d="M2.33154 9.40576V13.1685C2.3318 13.4444 2.55556 13.6685 2.83154 13.6685H6.49463V14.6685H2.83154C2.00328 14.6685 1.3318 13.9967 1.33154 13.1685V9.40576H2.33154ZM13.1685 1.33154C13.9964 1.33199 14.6683 2.00352 14.6685 2.83154V6.40576H13.6685V2.83154C13.6683 2.5558 13.4441 2.33199 13.1685 2.33154H9.49463V1.33154H13.1685Z" fill="currentColor" />
    <path d="M9.4292 6.57077L13.914 2.08594" stroke="currentColor" />
    <path d="M6.57077 9.4292L2.08594 13.914" stroke="currentColor" />
  </svg>
)

/** Regular one-pixel IconFullscreenOutline artwork. */
export const IconFullscreenOutlineRegular = (props: IconProps) => (
  <IconFullscreenOutlineArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconFullscreenOutline artwork with a 1.3px stroke. */
export const IconFullscreenOutlineMedium = (props: IconProps) => (
  <IconFullscreenOutlineArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)

const IconCodeOutlineArtwork = ({ size = 16, className, strokeWidth }: WeightedIconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={strokeWidth}>
    <path d="M6.27612 1.5L4.52612 14.5" stroke="currentColor" />
    <path d="M11.4739 1.5L9.72388 14.5" stroke="currentColor" />
    <path d="M2.39868 5.5H14.0681" stroke="currentColor" />
    <path d="M1.93188 10.5H13.6013" stroke="currentColor" />
  </svg>
)

/** Regular one-pixel IconCodeOutline artwork. */
export const IconCodeOutlineRegular = (props: IconProps) => (
  <IconCodeOutlineArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconCodeOutline artwork with a 1.3px stroke. */
export const IconCodeOutlineMedium = (props: IconProps) => (
  <IconCodeOutlineArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)

const IconCordisPluginOutlineArtwork = ({ size = 14, className, strokeWidth }: WeightedIconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={strokeWidth}>
    <path d="M3.16143 6.59068L1.75205 8.00006L3.10619 9.35419L2.39908 10.0613L0.832948 8.49517C0.559581 8.2218 0.559582 7.77831 0.832948 7.50494L2.45432 5.88357L3.16143 6.59068ZM8.49511 15.1671C8.22176 15.4405 7.77826 15.4404 7.50489 15.1671L5.93461 13.5968L6.64172 12.8897L8 14.248L9.40938 12.8386L10.1165 13.5457L8.49511 15.1671ZM15.1671 7.50494C15.4403 7.7782 15.4401 8.22179 15.1671 8.49517L13.652 10.0102L12.9449 9.30309L14.248 8.00006L12.8897 6.64178L13.5968 5.93467L15.1671 7.50494ZM9.35414 3.10624L8 1.7521L6.69696 3.05514L5.98986 2.34803L7.50489 0.833003C7.77828 0.559981 8.22186 0.559752 8.49511 0.833003L10.0612 2.39913L9.35414 3.10624Z" fill="currentColor" />
    <circle cx="8" cy="8" r="1.76221" stroke="currentColor" />
  </svg>
)

/** Regular one-pixel IconCordisPluginOutline artwork. */
export const IconCordisPluginOutlineRegular = (props: IconProps) => (
  <IconCordisPluginOutlineArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconCordisPluginOutline artwork with a 1.3px stroke. */
export const IconCordisPluginOutlineMedium = (props: IconProps) => (
  <IconCordisPluginOutlineArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)

const IconApiOutlineArtwork = ({ size = 14, className, strokeWidth }: WeightedIconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={strokeWidth}>
    <path d="M3 4L7 8L3 12" stroke="currentColor" />
    <path d="M9 12H13" stroke="currentColor" />
  </svg>
)

/** Regular one-pixel IconApiOutline artwork. */
export const IconApiOutlineRegular = (props: IconProps) => (
  <IconApiOutlineArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconApiOutline artwork with a 1.3px stroke. */
export const IconApiOutlineMedium = (props: IconProps) => (
  <IconApiOutlineArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)

const IconPersonalizationOutlineArtwork = ({ size = 16, className, strokeWidth }: WeightedIconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={strokeWidth}>
    <path d="M3.25 7.16357C3.20417 7.32247 3.17778 7.48993 3.17773 7.66357C3.17773 7.83698 3.20336 8.00486 3.24902 8.16357H1.85742V7.16357H3.25ZM14.1426 8.16357H6.71484C6.76052 8.00485 6.78613 7.837 6.78613 7.66357C6.78609 7.48991 6.75971 7.32249 6.71387 7.16357H14.1426V8.16357Z" fill="currentColor" />
    <path d="M9.1377 11.9092C9.08596 12.0666 9.05668 12.2344 9.05664 12.4092C9.05664 12.5838 9.08606 12.7518 9.1377 12.9092H1.85742V11.9092H9.1377ZM14.1426 12.9092H12.1816C12.2332 12.7519 12.2617 12.5838 12.2617 12.4092C12.2617 12.2345 12.2333 12.0666 12.1816 11.9092H14.1426V12.9092Z" fill="currentColor" />
    <path d="M9.1123 3.09106C9.06138 3.24865 9.03324 3.41653 9.0332 3.59106C9.0332 3.76549 9.06148 3.93355 9.1123 4.09106H1.85742V3.09106H9.1123ZM14.1426 4.09106H12.207C12.2578 3.93358 12.2861 3.76545 12.2861 3.59106C12.2861 3.41657 12.2579 3.24862 12.207 3.09106H14.1426V4.09106Z" fill="currentColor" />
    <circle cx="4.97065" cy="7.66401" r="1.35151" stroke="currentColor" />
    <circle cx="10.6596" cy="12.4091" r="1.35151" stroke="currentColor" />
    <circle cx="10.6596" cy="3.59101" r="1.35151" stroke="currentColor" />
  </svg>
)

/** Regular one-pixel IconPersonalizationOutline artwork. */
export const IconPersonalizationOutlineRegular = (props: IconProps) => (
  <IconPersonalizationOutlineArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconPersonalizationOutline artwork with a 1.3px stroke. */
export const IconPersonalizationOutlineMedium = (props: IconProps) => (
  <IconPersonalizationOutlineArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)

const IconProjectAddOutlineArtwork = ({ size = 16, className, strokeWidth }: WeightedIconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={strokeWidth}>
    <path d="M5.54492 2.06738C5.91034 2.06754 6.26318 2.20149 6.53711 2.44336L7.94043 3.68164V4.7998C7.71462 4.74105 7.50367 4.63139 7.32617 4.47461L5.87598 3.19238C5.78477 3.11185 5.66658 3.06754 5.54492 3.06738H2.94922C2.67322 3.06738 2.44946 3.29145 2.44922 3.56738V12.4326C2.44927 12.7087 2.67311 12.9326 2.94922 12.9326H12.9326C13.2086 12.9325 13.4326 12.7086 13.4326 12.4326V8.53613H14.4326V12.4326C14.4326 13.2609 13.7609 13.9325 12.9326 13.9326H2.94922C2.12083 13.9326 1.44927 13.261 1.44922 12.4326V3.56738C1.44946 2.73916 2.12094 2.06738 2.94922 2.06738H5.54492Z" fill="currentColor" />
    <path d="M9.75977 4.50208H14.5509" stroke="currentColor" />
    <path d="M12.1492 6.89758L12.1492 2.10642" stroke="currentColor" />
  </svg>
)

/** Regular one-pixel IconProjectAddOutline artwork. */
export const IconProjectAddOutlineRegular = (props: IconProps) => (
  <IconProjectAddOutlineArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconProjectAddOutline artwork with a 1.3px stroke. */
export const IconProjectAddOutlineMedium = (props: IconProps) => (
  <IconProjectAddOutlineArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)

const IconFolderOpenOutlineArtwork = ({ size = 16, className, strokeWidth }: WeightedIconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={strokeWidth}>
    <path d="M12.3994 13.5986H2.04956C1.49728 13.5986 1.04956 13.1509 1.04956 12.5986V3.40137C1.04956 2.84908 1.49728 2.40137 2.04956 2.40137H4.76632C5.01016 2.40137 5.24561 2.49046 5.42836 2.6519L6.94088 3.98799C7.12364 4.14943 7.35908 4.23852 7.60293 4.23852H12.3994C12.9517 4.23852 13.3994 4.68624 13.3994 5.23852V7.16991" stroke="currentColor" />
    <path d="M2.55911 7.93683C2.67584 7.49906 3.07229 7.19446 3.52536 7.19446H13.6491C14.3061 7.19446 14.7846 7.81725 14.6153 8.45209L13.4411 12.856C13.3244 13.2938 12.9279 13.5984 12.4748 13.5984H2.35113C1.69411 13.5984 1.21562 12.9756 1.38489 12.3407L2.55911 7.93683Z" stroke="currentColor" />
  </svg>
)

/** Regular one-pixel IconFolderOpenOutline artwork. */
export const IconFolderOpenOutlineRegular = (props: IconProps) => (
  <IconFolderOpenOutlineArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconFolderOpenOutline artwork with a 1.3px stroke. */
export const IconFolderOpenOutlineMedium = (props: IconProps) => (
  <IconFolderOpenOutlineArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)

const IconFolderOpenArtwork = ({ size = 16, className, strokeWidth }: WeightedIconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={strokeWidth}>
    <path d="M2.55912 7.93683C2.67584 7.49906 3.0723 7.19446 3.52536 7.19446H13.6491C14.3061 7.19446 14.7846 7.81725 14.6153 8.45209L13.4411 12.856C13.3244 13.2938 12.9279 13.5984 12.4748 13.5984H2.35113C1.69411 13.5984 1.21562 12.9756 1.38489 12.3407L2.55912 7.93683Z" fill="currentColor" opacity="0.16" />
    <path d="M13.6491 6.69446C14.6346 6.69453 15.3522 7.62895 15.0983 8.58118L13.9245 12.9845C13.7494 13.6412 13.1539 14.0988 12.4743 14.0988H2.35126C1.36574 14.0988 0.648153 13.1643 0.902044 12.212L2.07587 7.80774C2.25102 7.15128 2.84567 6.69455 3.52509 6.69446H13.6491ZM3.52509 7.69446C3.29865 7.69455 3.10004 7.84674 3.04169 8.06555L1.86786 12.4698C1.78345 12.7872 2.02285 13.0988 2.35126 13.0988H12.4743C12.7007 13.0988 12.8992 12.9463 12.9577 12.7277L14.1325 8.32336C14.2171 8.00598 13.9776 7.69453 13.6491 7.69446H3.52509Z" fill="currentColor" />
    <path d="M4.7666 1.90137C5.13227 1.90144 5.48571 2.03525 5.75977 2.27734L7.27246 3.61328C7.36379 3.69382 7.48174 3.73828 7.60352 3.73828H12.3994C13.2276 3.73841 13.8993 4.41005 13.8994 5.23828V6.7168C13.8183 6.70327 13.735 6.69436 13.6494 6.69434H12.8994V5.23828C12.8993 4.96233 12.6754 4.73841 12.3994 4.73828H7.60352C7.23781 4.73828 6.88446 4.60438 6.61035 4.3623L5.09766 3.02637C5.00636 2.94576 4.88838 2.90144 4.7666 2.90137H2.0498C1.77366 2.90137 1.5498 3.12523 1.5498 3.40137V9.78223L0.902344 12.2119C0.648452 13.1642 1.36604 14.0986 2.35156 14.0986H2.0498C1.2214 14.0986 0.549838 13.427 0.549805 12.5986V3.40137C0.549805 2.57294 1.22138 1.90137 2.0498 1.90137H4.7666Z" fill="currentColor" />
  </svg>
)

/** Regular IconFolderOpen artwork; its fill-only geometry is weight-independent. */
export const IconFolderOpenRegular = (props: IconProps) => (
  <IconFolderOpenArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconFolderOpen artwork; it matches Regular because the geometry is fill-only. */
export const IconFolderOpenMedium = (props: IconProps) => (
  <IconFolderOpenArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)

/** Regular one-pixel IconFolderClose artwork. */
export const IconFolderCloseRegular = (props: IconProps) => (
  <FolderCloseArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconFolderClose artwork with a 1.3px stroke. */
export const IconFolderCloseMedium = (props: IconProps) => (
  <FolderCloseArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)

const IconTreeCornerArtwork = ({ size = 10, className, strokeWidth }: WeightedIconProps) => (
  <svg width={(size * 8) / 10} height={size} className={className} viewBox="0 0 9 11" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={strokeWidth}>
    <path d="M0.5 0V7C0.5 7.79565 0.81607 8.55871 1.37868 9.12132C1.94129 9.68393 2.70435 10 3.5 10H8.5" stroke="currentColor" />
  </svg>
)

/** Regular one-pixel IconTreeCorner artwork. */
export const IconTreeCornerRegular = (props: IconProps) => (
  <IconTreeCornerArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconTreeCorner artwork with a 1.3px stroke. */
export const IconTreeCornerMedium = (props: IconProps) => (
  <IconTreeCornerArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)

const IconLightOutlineArtwork = ({ size = 16, className, strokeWidth }: WeightedIconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={strokeWidth}>
    <path d="M8.00007 11.8117C10.1052 11.8117 11.8117 10.1052 11.8117 8.00007C11.8117 5.89499 10.1052 4.18848 8.00007 4.18848C5.89499 4.18848 4.18848 5.89499 4.18848 8.00007C4.18848 10.1052 5.89499 11.8117 8.00007 11.8117Z" stroke="currentColor" />
    <path d="M13.3899 8H15.1499" stroke="currentColor" />
    <path d="M11.8115 11.8115L13.0556 13.0556" stroke="currentColor" />
    <path d="M8 13.3901V15.1501" stroke="currentColor" />
    <path d="M4.18868 11.8115L2.94458 13.0556" stroke="currentColor" />
    <path d="M2.6101 8H0.850098" stroke="currentColor" />
    <path d="M4.18868 4.18856L2.94458 2.94446" stroke="currentColor" />
    <path d="M8 2.6101V0.850098" stroke="currentColor" />
    <path d="M11.8115 4.18856L13.0556 2.94446" stroke="currentColor" />
  </svg>
)

/** Regular one-pixel IconLightOutline artwork. */
export const IconLightOutlineRegular = (props: IconProps) => (
  <IconLightOutlineArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconLightOutline artwork with a 1.3px stroke. */
export const IconLightOutlineMedium = (props: IconProps) => (
  <IconLightOutlineArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)
