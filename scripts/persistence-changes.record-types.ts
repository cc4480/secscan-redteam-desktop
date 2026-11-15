/** Record, transition, and command-result types shared by persistence-change verification. */

import type { PersistenceRoot, PersistenceSchemaInventory } from './persistence-schema-model.ts'

/** The author's acknowledgement of one mechanically classified transition. */
export type PersistenceDecision = 'same-version' | 'version-bump'

/** One root's successor; null after values preserve a deletion in its history. */
export interface PersistenceChange {
  readonly root: string
  readonly previous: string | null
  readonly after: string | null
  readonly decision: PersistenceDecision
}

/** A document's machine record, independent of its translated prose. */
export interface PersistenceChangeRecord {
  readonly schemaVersion: 1
  readonly id: string
  readonly baseline: boolean
  readonly changes: readonly PersistenceChange[]
}

/** A parsed acknowledgement and its self-contained after schemas. */
export interface PersistenceHistoryEntry {
  readonly record: PersistenceChangeRecord
  readonly snapshot: PersistenceSchemaInventory
}

/** One detected type change, with a path that reviewers can locate. */
export interface PersistenceTypeChange {
  readonly kind: PersistenceTypeChangeKind
  readonly path: string
  readonly description: string
  readonly requiresVersionBump: boolean
}

/** Diagnostic prose for each structural change kind. */
export const CHANGE_DESCRIPTIONS = {
  'root-added': 'root added',
  'root-removed': 'root removed',
  'root-classification-changed': 'root classification changed',
  'type-changed': 'type changed',
  'property-removed': 'property removed',
  'property-made-optional': 'property made optional',
  'property-made-required': 'property made required',
  'optional-property-added': 'optional property added',
  'required-property-added': 'required property added',
  'index-signature-changed': 'index signature changed',
  'tuple-length-changed': 'tuple length changed',
  'tuple-element-cardinality-changed': 'tuple element cardinality changed',
  'payload-version-added': 'event payload version added',
  'union-variants-changed': 'union variants changed',
  'source-policy-changed': 'source compatibility policy changed',
  'attribution-kind-added': 'attribution-only source kind added',
} as const

/** Stable structural classification independent of diagnostic prose. */
export type PersistenceTypeChangeKind = keyof typeof CHANGE_DESCRIPTIONS

/** Author-supplied paragraphs used to complete one language of a change record. */
export interface PersistenceChangeProse {
  readonly summary: string
  readonly compatibility: string
  readonly verification: string
}

/** Explicit bilingual prose; the CLI supplies no compatibility or validation claims. */
export interface PersistenceChangeProsePair {
  readonly en: PersistenceChangeProse
  readonly zh: PersistenceChangeProse
}

/** One detected type change attributed to the root it belongs to. */
export interface ReportedChange extends PersistenceTypeChange {
  readonly root: string
}

/** One root's classification and digests on either side of a transition. */
export interface RootTransition {
  readonly root: string
  readonly kind: PersistenceRoot['kind']
  readonly before: string | null
  readonly after: string | null
}

/** Verification failure carrying the structural detail a JSON result reports. */
export class PersistenceChangeFailure extends Error {
  constructor(
    message: string, readonly code: string, readonly changes: readonly ReportedChange[] = [],
    readonly roots: readonly RootTransition[] = [],
  ) {
    super(message)
  }
}

/** The JSON result of one command invocation. */
export interface CommandResult {
  readonly schemaVersion: 1
  readonly ok: boolean
  readonly operation: 'check' | 'baseline' | 'record' | 'update'
  readonly message: string
  readonly changes: readonly ReportedChange[]
  readonly roots: readonly RootTransition[]
  readonly files: readonly string[]
  readonly recordId?: string
  readonly code?: string
}

/** One root's newest acknowledged record and its after schema. */
export interface Tip {
  readonly id: string
  readonly root: PersistenceRoot | null
}

/** Verified per-root history tips; historical schemas need not match the current tree. */
export interface PersistenceHistory {
  readonly entries: readonly PersistenceHistoryEntry[]
  readonly tips: ReadonlyMap<string, Tip>
}
