import { LINK_MAP_TELEMETRY_TO_COMPACTION } from './gen-cordis-catalog-link-map-a.ts'
import { LINK_MAP_FILESYSTEM_TO_VOICE_INPUT } from './gen-cordis-catalog-link-map-b.ts'
import { LINK_MAP_AGENT_TEAM_TO_TYPERT } from './gen-cordis-catalog-link-map-c.ts'

/**
 * One primary subsystems page per project type used by a generated
 * signature. This stays curated because union names intentionally do not
 * reuse the type-equivalence manifest's map-symbol entries and some symbols
 * appear on more than one page.
 */
export const LINK_MAP: Readonly<Record<string, string>> = {
  ...LINK_MAP_TELEMETRY_TO_COMPACTION,
  ...LINK_MAP_FILESYSTEM_TO_VOICE_INPUT,
  ...LINK_MAP_AGENT_TEAM_TO_TYPERT,
}
