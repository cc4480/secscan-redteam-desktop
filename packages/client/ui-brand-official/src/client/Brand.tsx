import { BrandWordmark, DiamondLogo } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'

/**
 * Render the official mark with the presentation requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the official diamond mark.
 */
export function OfficialBrandMark({ size }: SidebarBrandMarkOwnerProps) {
  return <DiamondLogo size={size} />
}

/**
 * Render the official mark for the conversation hero seat. The mark carries
 * its own fixed fills, so it ignores the slot-supplied `color`; `className`
 * passes through so the hero can position the occupant.
 * @param props - Host-supplied mark presentation.
 * @returns the official diamond mark.
 */
export function OfficialHeroBrandMark({ size, className }: HeroBrandMarkOwnerProps) {
  return <DiamondLogo size={size} className={className} />
}

/**
 * Render the official name artwork without its independently slotted mark.
 * @returns the official name wordmark.
 */
export function OfficialBrandName() {
  return <BrandWordmark includeMark={false} />
}
