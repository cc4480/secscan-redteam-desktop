/** Acknowledgement history validation: per-root chains, tips, finalization, and current-tree checks. */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { classifyPersistenceChange } from './persistence-changes.classification.ts'
import { headerVersion, parseDocument, parsePersistenceSnapshot } from './persistence-changes.parse-inventory.ts'
import { CURRENT_SCHEMA, EVIDENCE_PLACEHOLDER, EXPLANATION_PLACEHOLDER, HISTORY_DIRECTORY } from './persistence-changes.constants.ts'
import { PersistenceChangeFailure } from './persistence-changes.record-types.ts'
import type {
  PersistenceChange, PersistenceHistory, PersistenceHistoryEntry, ReportedChange, RootTransition, Tip,
} from './persistence-changes.record-types.ts'
import type { PersistenceRoot, PersistenceSchemaInventory } from './persistence-schema-model.ts'
import { loadPersistenceFinalization } from './persistence-finalization.ts'

/** Check every historical transition and return each root's unique current tip.
 * @param entries - parsed documents and their self-contained schema snapshots.
 * @returns validated history and tips, without consulting Git or current source.
 */
export function validatePersistenceHistory(entries: readonly PersistenceHistoryEntry[]): PersistenceHistory {
  if (entries.filter(entry => entry.record.baseline).length !== 1) throw new Error('persistence history requires exactly one baseline')
  const records = new Map<string, PersistenceHistoryEntry>()
  for (const entry of entries) {
    if (records.has(entry.record.id)) throw new Error(`duplicate persistence record ${entry.record.id}`)
    records.set(entry.record.id, entry)
    const expected = entry.record.changes.filter(change => change.after !== null).map(change => change.root).sort()
    if (JSON.stringify(expected) !== JSON.stringify(entry.snapshot.roots.map(root => root.key).sort())) throw new Error(`${entry.record.id}: snapshot roots do not match acknowledged after schemas`)
    for (const change of entry.record.changes) {
      const root = entry.snapshot.roots.find(root => root.key === change.root)
      if ((root?.digest ?? null) !== change.after) throw new Error(`${entry.record.id}: after digest mismatch for ${change.root}`)
      if (entry.record.baseline && (change.previous !== null || change.after === null || change.decision !== 'same-version')) throw new Error(`${entry.record.id}: invalid baseline transition`)
    }
  }
  const states = new Map<string, 'visiting' | 'visited'>()
  const successors = new Map<string, string>()
  const nodes = new Map<string, { entry: PersistenceHistoryEntry; change: PersistenceChange }>()
  const tips = new Map<string, Tip>()
  const nodeKey = (id: string | null, root: string): string => JSON.stringify([id, root])
  for (const entry of entries) for (const change of entry.record.changes) {
    const parentKey = nodeKey(change.previous, change.root)
    if (successors.has(parentKey)) throw new Error(`forked persistence history for ${change.root}: ${successors.get(parentKey)} and ${entry.record.id}`)
    successors.set(parentKey, entry.record.id)
    nodes.set(nodeKey(entry.record.id, change.root), { entry, change })
  }
  function visit(id: string, root: string): PersistenceRoot | null {
    const key = nodeKey(id, root)
    const found = nodes.get(key)
    if (found === undefined) throw new Error(`missing predecessor ${id} for ${root}`)
    if (states.get(key) === 'visiting') throw new Error(`cycle in persistence history for ${root}`)
    const after = found.entry.snapshot.roots.find(item => item.key === root) ?? null
    if (states.get(key) === 'visited') return after
    states.set(key, 'visiting')
    const before = found.change.previous === null ? null : visit(found.change.previous, root)
    if (!found.entry.record.baseline) {
      const differences = classifyPersistenceChange(before, after)
      if (differences.length === 0) throw new Error(`${id}: unchanged acknowledgement for ${root}`)
      if (differences.some(change => change.requiresVersionBump) && found.change.decision !== 'version-bump') {
        throw new PersistenceChangeFailure(
          `${id}: ${root} requires a format version bump (${differences.filter(change => change.requiresVersionBump).map(change => change.path + ': ' + change.description).join('; ')})`,
          'version-bump-required', differences.map(change => ({ root, ...change })), [rootTransition(before, after)],
        )
      }
      if (found.change.decision === 'version-bump') {
        const header = found.entry.record.changes.find(change => change.root === 'SessionHeader')
        const oldHeader = header?.previous === null || header === undefined ? null : visit(header.previous, 'SessionHeader')
        const from = headerVersion(oldHeader)
        const to = headerVersion(found.entry.snapshot.roots.find(item => item.key === 'SessionHeader') ?? null)
        if (from === undefined || to === undefined || to <= from) {
          throw new PersistenceChangeFailure(`${id}: version-bump requires this record's own increasing SessionHeader.version transition`,
            'version-transition-required', differences.map(change => ({ root, ...change })), [rootTransition(before, after)])
        }
      }
    }
    states.set(key, 'visited')
    if (!successors.has(key)) tips.set(root, { id, root: after })
    return after
  }
  for (const entry of entries) for (const change of entry.record.changes) visit(entry.record.id, change.root)
  const baseline = entries.find(entry => entry.record.baseline) as PersistenceHistoryEntry
  if (!baseline.snapshot.roots.some(root => root.key === 'SessionHeader')
    || !baseline.snapshot.roots.some(root => root.key === 'SessionEventEnvelope')
    || !baseline.snapshot.roots.some(root => root.key === 'JsonlHeaderLine')) {
    throw new Error('baseline requires SessionHeader, JsonlHeaderLine, and SessionEventEnvelope roots')
  }
  return { entries, tips }
}

/** Read and validate all current-tree persistence acknowledgement files.
 * @param root - checkout or isolated fixture root.
 * @returns checked history without comparing its tips to current source.
 */
export function loadPersistenceHistory(root: string): PersistenceHistory {
  return validatePersistenceHistory(readPersistenceEntries(root))
}

/** Read the acknowledgement documents, their snapshots, and their translated pairs.
 * @param root - checkout or isolated fixture root.
 * @param allowIncompleteId - record id permitted to keep scaffold placeholders.
 * @returns parsed entries in document order.
 */
export function readPersistenceEntries(root: string, allowIncompleteId?: string): PersistenceHistoryEntry[] {
  const directory = join(root, HISTORY_DIRECTORY)
  if (!existsSync(directory)) throw new Error('persistence history is missing; use pnpm run persistence-changes --baseline ID for explicit initialization')
  const files = readdirSync(directory).sort()
  const documents = files.filter(file => file.endsWith('.md') && !file.endsWith('.zh.md') && file !== 'README.md' && file !== 'AGENTS.md')
  const snapshots = new Set(files.filter(file => file.endsWith('.schema.json')))
  const entries = documents.map((filename) => {
    const source = readFileSync(join(directory, filename), 'utf8').replaceAll('\r\n', '\n')
    const allowIncomplete = filename === `${allowIncompleteId}.md`
    const change = parseDocument(source, filename, allowIncomplete)
    const snapshotName = `${change.id}.schema.json`
    if (!snapshots.delete(snapshotName)) throw new Error(`${filename}: missing schema snapshot ${snapshotName}`)
    const snapshot = parsePersistenceSnapshot(JSON.parse(readFileSync(join(directory, snapshotName), 'utf8')))
    const translatedName = `${change.id}.zh.md`
    if (!files.includes(translatedName)) throw new Error(`${filename}: missing Chinese counterpart`)
    const translated = readFileSync(join(directory, translatedName), 'utf8').replaceAll('\r\n', '\n')
    const englishBlock = source.match(/^```yaml persistence-change[^\S\n]*\n([\s\S]*?)^```[^\S\n]*$/mu)?.[1]
    const chineseBlocks = [...translated.matchAll(/^```yaml persistence-change[^\S\n]*\n([\s\S]*?)^```[^\S\n]*$/gmu)]
    if (chineseBlocks.length !== 1 || chineseBlocks[0]?.[1] !== englishBlock) throw new Error(`${filename}: bilingual machine records differ`)
    if (!allowIncomplete && (translated.includes(EXPLANATION_PLACEHOLDER) || translated.includes(EVIDENCE_PLACEHOLDER))) throw new Error(`${translatedName}: complete compatibility and verification prose`)
    return { record: change, snapshot }
  })
  if (snapshots.size !== 0) throw new Error(`unreferenced persistence schema snapshot: ${[...snapshots].join(', ')}`)
  return entries
}

/** List the roots whose tip differs from the current inventory.
 * @param history - validated history tips.
 * @param current - freshly extracted current-source inventory.
 * @returns differing root keys, sorted.
 */
export function currentDifferences(history: PersistenceHistory, current: PersistenceSchemaInventory): string[] {
  const roots = new Map(current.roots.map(root => [root.key, root]))
  const differences: string[] = []
  for (const key of new Set([...history.tips.keys(), ...roots.keys()])) {
    if (classifyPersistenceChange(history.tips.get(key)?.root ?? null, roots.get(key) ?? null).length !== 0) differences.push(key)
  }
  return differences.sort()
}

/** Reject current-tree changes that contradict an accepted Session format.
 * @param root - checkout or isolated fixture root.
 * @param entries - parsed acknowledgement entries.
 * @param current - freshly extracted current-source inventory.
 * @param updateId - record id being updated, or undefined for a new record.
 */
export function verifyFinalization(
  root: string, entries: readonly PersistenceHistoryEntry[], current: PersistenceSchemaInventory, updateId?: string,
): void {
  const finalized = loadPersistenceFinalization(root, { entries })
  if (finalized === undefined) return
  if (updateId !== undefined && finalized.acceptedRecords.has(updateId)) {
    throw new PersistenceChangeFailure(`cannot update finalized acknowledgement ${updateId}; create a successor record`, 'finalized-record-update')
  }
  const writer = headerVersion(current.roots.find(root => root.key === 'SessionHeader') ?? null)
  if (writer === undefined || writer < finalized.version) {
    throw new PersistenceChangeFailure(`Session writer must not precede finalized format ${finalized.version}`, 'finalized-version-order')
  }
  if (writer > finalized.version) return
  const afterRoots = new Map(current.roots.map(root => [root.key, root]))
  const changes: ReportedChange[] = []
  const transitions: RootTransition[] = []
  for (const key of [...new Set([...finalized.roots.keys(), ...afterRoots.keys()])].sort()) {
    const before = finalized.roots.get(key) ?? null
    const after = afterRoots.get(key) ?? null
    const differences = classifyPersistenceChange(before, after)
    if (differences.length === 0) continue
    changes.push(...differences.map(change => ({ root: key, ...change })))
    transitions.push(rootTransition(before, after))
  }
  if (changes.some(change => change.requiresVersionBump)) {
    throw new PersistenceChangeFailure(
      `Breaking changes relative to the accepted Session format ${writer} baseline require format ${writer + 1} or later`,
      'finalized-format-changed', changes, transitions,
    )
  }
}

/** Verify current generated output and acknowledgement tips together.
 * @param root - checkout or isolated fixture root.
 * @param current - freshly extracted current-source inventory.
 * @returns verified history.
 */
export function verifyPersistenceChanges(root: string, current: PersistenceSchemaInventory): PersistenceHistory {
  const history = loadPersistenceHistory(root)
  verifyFinalization(root, history.entries, current)
  const differences = reportedDifferences(history, current)
  const transitions = rootTransitions(history, current)
  const committedPath = join(root, CURRENT_SCHEMA)
  if (!existsSync(committedPath)) {
    throw new PersistenceChangeFailure(`${CURRENT_SCHEMA} is missing; regenerate the persistence catalog`, 'generated-artifact-missing', differences, transitions)
  }
  const committed = parsePersistenceSnapshot(JSON.parse(readFileSync(committedPath, 'utf8')))
  if (JSON.stringify(committed) !== JSON.stringify(current)) {
    throw new PersistenceChangeFailure(`${CURRENT_SCHEMA} is stale; regenerate the persistence catalog`, 'stale-artifacts', differences, transitions)
  }
  if (differences.length !== 0) {
    const details = differences.map(change => `  ${change.path}: ${change.description} (${change.requiresVersionBump ? 'version-bump required' : 'same-version allowed'})`)
    throw new PersistenceChangeFailure(`unacknowledged persistence type changes:\n${details.join('\n')}`, 'unacknowledged-changes', differences, transitions)
  }
  return history
}

/** Describe one root transition for the JSON result.
 * @param before - predecessor root, or null for an addition.
 * @param after - successor root, or null for a deletion.
 * @returns the transition summary.
 */
export function rootTransition(before: PersistenceRoot | null, after: PersistenceRoot | null): RootTransition {
  const root = (after ?? before) as PersistenceRoot
  return { root: root.key, kind: root.kind, before: before?.digest ?? null, after: after?.digest ?? null }
}

/** Describe the root transitions covered by one command.
 * @param history - validated history, or undefined when no history exists yet.
 * @param current - freshly extracted current-source inventory.
 * @returns one transition per differing root.
 */
export function rootTransitions(history: PersistenceHistory | undefined, current: PersistenceSchemaInventory): RootTransition[] {
  const changed = history === undefined ? current.roots.map(root => root.key) : currentDifferences(history, current)
  return changed.map(root => rootTransition(history?.tips.get(root)?.root ?? null, current.roots.find(item => item.key === root) ?? null))
}

/** Attribute each current difference to its root.
 * @param history - validated history tips.
 * @param current - freshly extracted current-source inventory.
 * @returns every difference with its root key.
 */
export function reportedDifferences(history: PersistenceHistory, current: PersistenceSchemaInventory): ReportedChange[] {
  return currentDifferences(history, current).flatMap(root => classifyPersistenceChange(
    history.tips.get(root)?.root ?? null, current.roots.find(item => item.key === root) ?? null,
  ).map(change => ({ root, ...change })))
}
