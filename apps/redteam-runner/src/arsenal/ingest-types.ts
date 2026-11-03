/**
 * Ingest row/count shapes — extracted from `ingest.ts` so every module stays
 * inside the runner's 300-line file budget. Pure type declarations; the
 * parent re-exports them unchanged.
 */

/** One Level 1 collection row (spec §4.2), in the store's column shape. */
export interface ArsenalCollectionRow {
  slug: string
  name: string
  url: string
  description: string
  topic: string
}

/** One normalized entry (spec §4.3) — the Level 2 shape, collection added by the caller. */
export interface ArsenalEntry {
  name: string
  url: string
  description: string
}

/** Counters shared by both parse levels; the arithmetic always reconciles:
 *  itemCount = entries + dupeCount + urllessCount + unparsedCount. */
export interface ArsenalParseCounts {
  itemCount: number
  dupeCount: number
  urllessCount: number
  unparsedCount: number
}

export interface Level1Parse extends ArsenalParseCounts {
  collections: ArsenalCollectionRow[]
}

export interface LinkedListParse extends ArsenalParseCounts {
  entries: ArsenalEntry[]
}
