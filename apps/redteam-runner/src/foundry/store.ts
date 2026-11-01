/**
 * App-data Foundry store: the live-case registry scans feed.
 *
 * Layout under <engagementsRoot>/../foundry-store/:
 *   registry.json          append-only index of every registered case
 *   bundles/<case-id>/case.json   the case record itself
 *   sanitizer-notes.jsonl  counts/reasons for dropped cases (never content)
 *   loop-state.json        Gold Loop cycle state (written by loop.ts)
 *
 * Registration is idempotent: a case id is derived deterministically from
 * the source engagement id + the case content hash, and re-registering the
 * same (engagement, content) pair adds nothing. Registry entries are never
 * mutated or removed by the pipeline — new entries append.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'

/** Vuln families the Foundry classifies into; anything else is unclassified. */
export type FoundryFamily = 'sqli' | 'ssrf' | 'traversal' | 'xss' | 'unclassified'

/** Case tiers. GOLD is never assigned by this pipeline (editor-adjudicated). */
export type FoundryTier = 'BRONZE' | 'SILVER' | 'GOLD'

/**
 * One sanitized live case. Pattern fields only: endpoint shapes, payload
 * class, proof type, stack fingerprints. Raw evidence never enters a case.
 */
export interface FoundryCase {
  id: string
  kind: 'live-case'
  origin: 'scan' | 'loop-mutant'
  family: FoundryFamily
  vulnClass: string
  cwe: string | null
  severity: string
  endpointShape: string[]
  methodMix: string[]
  payloadClass: string
  proofType: string
  mechanisms: string[]
  techFingerprints: string[]
  tier: FoundryTier
  sourceEngagementId: string | null
  lineage: { seedCaseId?: string; seedSlug?: string; operator?: string; cycle?: number } | null
  createdAt: string
  contentHash: string
}

/** One append-only registry row. */
export interface RegistryEntry {
  id: string
  kind: string
  origin: string
  family: string
  tier: string
  sourceEngagementId: string | null
  createdAt: string
  contentHash: string
  lineage: FoundryCase['lineage']
}

/** The registry file. */
export interface FoundryRegistry {
  version: 1
  entries: RegistryEntry[]
}

/** The pattern fields a content hash commits to (no ids, no timestamps). */
export interface CasePattern {
  family: string
  vulnClass: string
  cwe: string | null
  severity: string
  endpointShape: string[]
  methodMix: string[]
  payloadClass: string
  proofType: string
  techFingerprints: string[]
}

/**
 * The store directory for a console engagements root.
 *
 * @param engagementsRoot - the directory holding engagement directories
 * @returns the sibling foundry-store directory
 */
export function foundryStoreDir(engagementsRoot: string): string {
  return join(engagementsRoot, '..', 'foundry-store')
}

/**
 * The store directory for one engagement directory.
 *
 * @param engagementDir - a single engagement's directory
 * @returns the foundry-store directory two levels up (sibling of the root)
 */
export function storeDirForEngagement(engagementDir: string): string {
  return join(engagementDir, '..', '..', 'foundry-store')
}

/**
 * Content hash of a case pattern: sha256 of its canonical JSON.
 *
 * @param pattern - the pattern fields
 * @returns the lowercase hex digest
 */
export function caseContentHash(pattern: CasePattern): string {
  const canonical = JSON.stringify({
    family: pattern.family,
    vulnClass: pattern.vulnClass,
    cwe: pattern.cwe,
    severity: pattern.severity,
    endpointShape: [...pattern.endpointShape].sort(),
    methodMix: [...pattern.methodMix].sort(),
    payloadClass: pattern.payloadClass,
    proofType: pattern.proofType,
    techFingerprints: [...pattern.techFingerprints].sort(),
  })
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}

/**
 * Deterministic case id for a scan-derived case.
 *
 * @param engagementId - the source engagement id
 * @param contentHash - the case content hash
 * @returns the case id
 */
export function caseIdFor(engagementId: string, contentHash: string): string {
  const digest = createHash('sha256').update(`${engagementId}\n${contentHash}`, 'utf8').digest('hex')
  return `case-${digest.slice(0, 16)}`
}

/** Write a file atomically (tmp + rename; unlink first on Windows). */
export function atomicWriteFile(path: string, body: string): void {
  const tmp = `${path}.tmp-${process.pid}-${Date.now().toString(36)}`
  try {
    writeFileSync(tmp, body)
    try {
      renameSync(tmp, path)
    } catch {
      rmSync(path, { force: true })
      renameSync(tmp, path)
    }
  } finally {
    if (existsSync(tmp)) rmSync(tmp, { force: true })
  }
}

/**
 * Load the registry; an absent registry reads as empty. A registry that
 * exists but cannot be read, parsed, or recognized fails loud instead:
 * reading it as empty lets the next registerCase rewrite the file with
 * only its own entry, silently dropping every registered case from the
 * index (the bundle files stay on disk, orphaned).
 *
 * @param storeDir - the foundry store directory
 * @returns the registry (empty when the file is absent)
 */
export function loadRegistry(storeDir: string): FoundryRegistry {
  const path = join(storeDir, 'registry.json')
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, entries: [] }
    throw new Error(`[foundry] registry at ${path} could not be read: ${err instanceof Error ? err.message : String(err)}`)
  }
  let raw: Partial<FoundryRegistry>
  try {
    raw = JSON.parse(text) as Partial<FoundryRegistry>
  } catch (err) {
    throw new Error(`[foundry] registry at ${path} is not valid JSON — refusing to read it as empty: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!raw || !Array.isArray(raw.entries)) {
    throw new Error(`[foundry] registry at ${path} has an unrecognized shape (no entries array) — refusing to read it as empty`)
  }
  return { version: 1, entries: raw.entries as RegistryEntry[] }
}

/**
 * Register one case: write its bundle file and append its registry entry.
 * Idempotent on (id) and on (sourceEngagementId + contentHash).
 *
 * @param storeDir - the foundry store directory
 * @param foundryCase - the case to register
 * @returns true when the case was newly added, false when already present
 */
export function registerCase(storeDir: string, foundryCase: FoundryCase): boolean {
  const registry = loadRegistry(storeDir)
  const dupe = registry.entries.some(
    e => e.id === foundryCase.id
      || (e.sourceEngagementId === foundryCase.sourceEngagementId && e.contentHash === foundryCase.contentHash),
  )
  if (dupe) return false
  const bundleDir = join(storeDir, 'bundles', foundryCase.id)
  mkdirSync(bundleDir, { recursive: true })
  atomicWriteFile(join(bundleDir, 'case.json'), JSON.stringify(foundryCase, null, 2) + '\n')
  registry.entries.push({
    id: foundryCase.id,
    kind: foundryCase.kind,
    origin: foundryCase.origin,
    family: foundryCase.family,
    tier: foundryCase.tier,
    sourceEngagementId: foundryCase.sourceEngagementId,
    createdAt: foundryCase.createdAt,
    contentHash: foundryCase.contentHash,
    lineage: foundryCase.lineage,
  })
  atomicWriteFile(join(storeDir, 'registry.json'), JSON.stringify(registry, null, 2) + '\n')
  return true
}

/**
 * Read one registered case record by id.
 *
 * @param storeDir - the foundry store directory
 * @param id - the case id
 * @returns the case, or null when absent/unparseable
 */
export function readCase(storeDir: string, id: string): FoundryCase | null {
  try {
    return JSON.parse(readFileSync(join(storeDir, 'bundles', id, 'case.json'), 'utf8')) as FoundryCase
  } catch {
    return null
  }
}

/**
 * Every registered case record, in registry order.
 *
 * @param storeDir - the foundry store directory
 * @returns the case records (entries whose files vanished are skipped)
 */
export function listCases(storeDir: string): FoundryCase[] {
  const out: FoundryCase[] = []
  for (const entry of loadRegistry(storeDir).entries) {
    const foundryCase = readCase(storeDir, entry.id)
    if (foundryCase) out.push(foundryCase)
  }
  return out
}

/**
 * Record a sanitizer drop: counts and reasons only, never case content.
 *
 * @param storeDir - the foundry store directory
 * @param note - the drop note (family guess, reasons, engagement id)
 * @returns nothing
 */
export function appendSanitizerNote(storeDir: string, note: { engagementId: string; reasons: string[]; at: string }): void {
  mkdirSync(storeDir, { recursive: true })
  appendFileSync(join(storeDir, 'sanitizer-notes.jsonl'), JSON.stringify(note) + '\n')
}

/**
 * The most recent sanitizer notes.
 *
 * @param storeDir - the foundry store directory
 * @param limit - maximum notes to return
 * @returns the notes, newest last; [] when none
 */
export function readSanitizerNotes(storeDir: string, limit: number): Array<{ engagementId: string; reasons: string[]; at: string }> {
  try {
    const lines = readFileSync(join(storeDir, 'sanitizer-notes.jsonl'), 'utf8').split('\n').filter(l => l.trim())
    const notes: Array<{ engagementId: string; reasons: string[]; at: string }> = []
    for (const line of lines) {
      try {
        notes.push(JSON.parse(line) as { engagementId: string; reasons: string[]; at: string })
      } catch {
        /* skip a torn line */
      }
    }
    return notes.slice(Math.max(0, notes.length - limit))
  } catch {
    return []
  }
}

/** Directory-name safety for case ids used as path segments. */
export function isCaseId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) && !id.includes('..')
}
