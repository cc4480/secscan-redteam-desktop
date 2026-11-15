/**
 * Headings, records, and running tallies exchanged by the package README Model
 * Experience gate's modules.
 */

import type { MarkdownProseLine } from './markdown.ts'

/** Canonical H2 section heading every structured package README carries. */
export const HEADING = '## Model Experience'
/** Optional final H2 section that must follow the Model Experience section. */
export const LIMITATIONS_HEADING = '## Known Limitations and Deferred Work'
/** H4 field heading carrying the model-visible contribution paragraph. */
export const MODEL_VIEW_HEADING = '#### What the model sees'
/** H4 field heading carrying the token-cost paragraph. */
export const TOKEN_EFFECT_HEADING = '#### Token effect'
/** H4 field heading carrying the KV-cache paragraph. */
export const KV_CACHE_EFFECT_HEADING = '#### KV Cache effect'
/** The three H4 fields every model-context entry carries, in order. */
export const FIELD_HEADINGS = [MODEL_VIEW_HEADING, TOKEN_EFFECT_HEADING, KV_CACHE_EFFECT_HEADING] as const

/** One gate failure, keyed by the README path it concerns. */
export interface Failure {
  path: string
  message: string
}

/** One markdown content line, as reported by `markdownProseLines`. */
export type Line = MarkdownProseLine

/** One parsed model-context entry with its three field paragraphs. */
export interface ModelExperienceEntry {
  heading: Line
  modelView: Line
  tokenEffect: Line
  kvCacheEffect: Line
  title: string
  modelViewVerbatimBlocks: number
  verbatimBlocks: number
}

/** One parsed H4 field paragraph and the nested verbatim blocks beneath it. */
export interface ParsedField {
  value: Line
  verbatimBlocks: number
}

/** Sentence form an audited short Model Experience section must take. */
export type SentenceKind = 'none' | 'indirect'

/** The gated sentence and its KV-cache field for one audited package. */
export interface SentenceContract {
  kind: SentenceKind
  reason: string
}

/** Mutable tallies the per-package walk accumulates for the summary line. */
export interface Counters {
  structuredCount: number
  modelContextEntryCount: number
  omittedSectionCount: number
  explainedNoneCount: number
  indirectCount: number
  verbatimBlockCount: number
  systemPromptEntryCount: number
  toolSchemaEntryCount: number
  kvCacheEffectCount: number
}
