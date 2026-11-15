/** Command execution and document authoring for persistence-change verification. */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { persistenceCatalogArtifacts } from './gen-persistence-catalog.ts'
import { renderPersistencePair } from './persistence-artifacts.ts'
import { identifier, keys, record, textValue } from './persistence-changes.parse-schema.ts'
import { parseDocument, parsePersistenceSnapshot } from './persistence-changes.parse-inventory.ts'
import { EVIDENCE_PLACEHOLDER, EXPLANATION_PLACEHOLDER, HISTORY_DIRECTORY, ID_PATTERN } from './persistence-changes.constants.ts'
import { PersistenceChangeFailure } from './persistence-changes.record-types.ts'
import type {
  CommandResult, PersistenceChangeProse, PersistenceChangeProsePair, PersistenceChangeRecord, PersistenceHistory,
} from './persistence-changes.record-types.ts'
import {
  currentDifferences, readPersistenceEntries, reportedDifferences, rootTransitions, validatePersistenceHistory,
  verifyFinalization, verifyPersistenceChanges,
} from './persistence-changes.history-validation.ts'
import { extractPersistenceSchema } from './persistence-schema.ts'
import type { PersistenceArtifact } from './persistence-artifacts.ts'
import type { PersistenceSchemaInventory } from './persistence-schema-model.ts'

/** Render the machine block an acknowledgement document carries.
 * @param change - record to serialize.
 * @returns the fenced YAML block without a trailing newline.
 */
export function machineBlock(change: PersistenceChangeRecord): string {
  return ['```yaml persistence-change', 'schemaVersion: 1', `id: ${change.id}`, `baseline: ${String(change.baseline)}`, 'changes:',
    ...change.changes.flatMap(item => [`  - root: ${JSON.stringify(item.root)}`, `    previous: ${item.previous === null ? 'null' : JSON.stringify(item.previous)}`, `    after: ${item.after === null ? 'null' : JSON.stringify(item.after)}`, `    decision: ${item.decision}`]), '```'].join('\n')
}

/** Render a new bilingual acknowledgement document around a machine record.
 * @param change - record to embed.
 * @param chinese - render the Chinese counterpart rather than the English document.
 * @param prose - supplied section text, or scaffold placeholders when omitted.
 * @returns the complete document text.
 */
export function scaffold(change: PersistenceChangeRecord, chinese: boolean, prose?: PersistenceChangeProse): string {
  const summary = chinese ? '概述' : 'Summary'
  const compatibility = chinese ? '兼容性' : 'Compatibility'
  const verification = chinese ? '验证' : 'Verification'
  return ['---', `description: ${JSON.stringify(chinese ? '记录持久化类型更改及其兼容性确认。' : 'Records a persistence type transition and its compatibility acknowledgement.')}`, 'kind: persistence-change', '---', '',
    `# ${change.id}`, '', chinese ? `[English](${change.id}.md) | 中文` : `English | [中文](${change.id}.zh.md)`, '',
    `## ${summary}`, '', prose?.summary ?? EXPLANATION_PLACEHOLDER, '', '## ' + (chinese ? '目录' : 'Table of Contents'), '',
    `- [${chinese ? '声明' : 'Declaration'}](#declaration)`, `- [${compatibility}](#compatibility)`, `- [${verification}](#verification)`, `- [${chinese ? '开发备注' : 'Dev Note'}](#dev-note)`, '',
    '<a id="declaration"></a>', `## ${chinese ? '声明' : 'Declaration'}`, '', machineBlock(change), '',
    '<a id="compatibility"></a>', `## ${compatibility}`, '', prose?.compatibility ?? EXPLANATION_PLACEHOLDER, '',
    '<a id="verification"></a>', `## ${verification}`, '', prose?.verification ?? EVIDENCE_PLACEHOLDER, '', '<a id="dev-note"></a>', `## ${chinese ? '开发备注' : 'Dev Note'}`, '', chinese ? '无。' : 'None.', ''].join('\n')
}

/** Parse explicit authored prose without supplying compatibility or validation claims.
 * @param value - decoded JSON supplied through --prose.
 * @returns complete English and Chinese section text.
 */
export function parsePersistenceProse(value: unknown): PersistenceChangeProsePair {
  const pair = record(value, 'persistence prose')
  keys(pair, ['en', 'zh'], 'persistence prose')
  for (const locale of ['en', 'zh']) {
    const sections = record(pair[locale], `persistence prose ${locale}`)
    keys(sections, ['summary', 'compatibility', 'verification'], `persistence prose ${locale}`)
    for (const [name, value] of Object.entries(sections)) {
      const text = textValue(value, `${locale}.${name}`)
      if (text.trim().length === 0 || text.includes(EXPLANATION_PLACEHOLDER) || text.includes(EVIDENCE_PLACEHOLDER)) {
        throw new Error(`${locale}.${name} requires authored prose without scaffold placeholders`)
      }
    }
  }
  return pair as unknown as PersistenceChangeProsePair
}

/** Replace an existing document's machine block and optionally its prose sections.
 * @param source - current document text.
 * @param change - replacement machine record.
 * @param chinese - whether the document is the Chinese counterpart.
 * @param prose - section text to substitute, or undefined to keep existing prose.
 * @returns the updated document text.
 */
export function updateDocument(source: string, change: PersistenceChangeRecord, chinese: boolean, prose?: PersistenceChangeProse): string {
  source = source.replace(/^```yaml persistence-change[^\S\n]*\n[\s\S]*?^```[^\S\n]*$/mu, machineBlock(change))
  if (prose === undefined) return source
  const headings = chinese ? ['概述', '兼容性', '验证'] : ['Summary', 'Compatibility', 'Verification']
  for (const [index, text] of [prose.summary, prose.compatibility, prose.verification].entries()) {
    const lines = source.split('\n')
    const heading = `## ${headings[index]}`
    const start = lines.indexOf(heading)
    if (start < 0 || lines.lastIndexOf(heading) !== start) throw new Error(`--prose requires one ${heading} section in the existing record`)
    let end = lines.findIndex((line, lineIndex) => lineIndex > start && /^##? /u.test(line))
    if (end < 0) end = lines.length
    let anchor = end
    while (anchor > start + 1 && lines[anchor - 1] === '') anchor -= 1
    if (/^<a id="[^"]+"><\/a>$/u.test(lines[anchor - 1] ?? '')) end = anchor - 1
    lines.splice(start + 1, end - start - 1, '', text.trim(), '')
    source = lines.join('\n')
  }
  return source
}

/** Select the operation named on the command line.
 * @param args - raw command-line arguments.
 * @returns the selected operation, defaulting to check.
 */
export function commandOperation(args: readonly string[]): CommandResult['operation'] {
  if (args.some(arg => arg === '--baseline' || arg.startsWith('--baseline='))) return 'baseline'
  if (args.some(arg => arg === '--record' || arg.startsWith('--record='))) return 'record'
  if (args.some(arg => arg === '--update' || arg.startsWith('--update='))) return 'update'
  return 'check'
}

/** Run one check, baseline, record, or update operation.
 * @param args - raw command-line arguments.
 * @param root - checkout root the operation reads and writes.
 * @param extract - current-source extraction function.
 * @param artifacts - renderer for current generated artifacts.
 * @returns the structured command result.
 */
export function executeCommand(
  args: readonly string[], root: string, extract: (root: string) => PersistenceSchemaInventory,
  artifacts: (root: string, current: PersistenceSchemaInventory) => readonly PersistenceArtifact[],
): CommandResult {
  const { values } = parseArgs({ args: [...args], strict: true, allowPositionals: false, options: {
    check: { type: 'boolean' }, baseline: { type: 'string' }, record: { type: 'string' }, update: { type: 'string' },
    decision: { type: 'string' }, root: { type: 'string' }, prose: { type: 'string' }, json: { type: 'boolean' },
  } })
  if (values.root !== undefined) root = resolve(values.root)
  const selected = [values.check === true, values.baseline !== undefined, values.record !== undefined, values.update !== undefined]
  if (selected.filter(Boolean).length > 1) throw new Error('choose exactly one of --check, --baseline ID, --record ID, or --update ID')
  if (values.record === undefined && values.update === undefined && values.decision !== undefined) throw new Error('--decision requires --record or --update')
  const operation = commandOperation(args)
  if (operation === 'check' && values.prose !== undefined) throw new Error('--prose requires --baseline, --record, or --update')
  const prose = values.prose === undefined ? undefined : parsePersistenceProse(JSON.parse(readFileSync(resolve(root, values.prose), 'utf8')))
  const current = parsePersistenceSnapshot(extract(root))
  if (operation === 'check') {
    const history = verifyPersistenceChanges(root, current)
    return { schemaVersion: 1, ok: true, operation,
      message: `persistence changes: ${current.roots.length} roots match ${history.entries.length} history records.`, changes: [], roots: [], files: [] }
  }
  const baseline = operation === 'baseline'
  const update = operation === 'update'
  const id = identifier(values.baseline ?? values.record ?? values.update, 'record id')
  const directory = join(root, HISTORY_DIRECTORY)
  if (baseline && existsSync(directory) && readdirSync(directory).some(file => file.endsWith('.schema.json') || ID_PATTERN.test(file.replace(/\.md$/u, '')))) throw new Error('persistence baseline already exists; baseline creation cannot reset history')
  if (values.decision !== undefined && values.decision !== 'same-version' && values.decision !== 'version-bump') {
    throw new Error('--decision must be same-version or version-bump')
  }
  const entries = baseline ? [] : readPersistenceEntries(root, update ? id : undefined)
  verifyFinalization(root, entries, current, update ? id : undefined)
  const existing = update ? entries.find(entry => entry.record.id === id) : undefined
  if (update && existing === undefined) throw new Error(`${id}: cannot update a missing acknowledgement`)
  if (existing?.record.baseline === true) throw new Error('cannot update the persistence baseline')
  if (existing !== undefined && entries.some(entry => entry.record.changes.some(change => change.previous === id))) {
    throw new Error(`${id}: cannot update an acknowledgement with successors`)
  }
  const prior = entries.filter(entry => entry !== existing)
  const history = baseline ? undefined : validatePersistenceHistory(prior)
  const changed = baseline ? current.roots.map(root => root.key) : currentDifferences(history as PersistenceHistory, current)
  if (changed.length === 0) throw new Error('no persistence type changes to acknowledge')
  const differences = history === undefined ? [] : reportedDifferences(history, current)
  const decision = values.decision ?? (differences.some(change => change.requiresVersionBump) ? 'version-bump' : 'same-version')
  const roots = current.roots.filter(root => changed.includes(root.key))
  const change: PersistenceChangeRecord = { schemaVersion: 1, id, baseline, changes: changed.sort().map(key => ({
    root: key, previous: history?.tips.get(key)?.id ?? null,
    after: roots.find(root => root.key === key)?.digest ?? null, decision,
  })) }
  const snapshot: PersistenceSchemaInventory = { formatVersion: current.formatVersion, roots, types: [] }
  validatePersistenceHistory([...prior, { record: change, snapshot }])
  const document = (chinese: boolean): string => {
    const supplied = chinese ? prose?.zh : prose?.en
    return existing === undefined ? scaffold(change, chinese, supplied)
      : updateDocument(readFileSync(join(directory, `${id}${chinese ? '.zh' : ''}.md`), 'utf8'), change, chinese, supplied)
  }
  const english = document(false)
  const chinese = document(true)
  parseDocument(english, `${id}.md`, prose === undefined && existing === undefined)
  parseDocument(chinese, `${id}.md`, prose === undefined && existing === undefined)
  const recordFiles = [
    ...renderPersistencePair(root, `${HISTORY_DIRECTORY}/${id}.md`, english, chinese),
    { path: `${HISTORY_DIRECTORY}/${id}.schema.json`, content: JSON.stringify(snapshot, null, 2) + '\n' },
  ]
  if (!update && recordFiles.some(file => existsSync(join(root, file.path)))) throw new Error(`${id}: acknowledgement file already exists`)
  const outputs = [...artifacts(root, current), ...recordFiles]
  for (const file of outputs) mkdirSync(resolve(root, file.path, '..'), { recursive: true })
  for (const file of outputs) writeFileSync(resolve(root, file.path), file.content, { flag: recordFiles.includes(file) && !update ? 'wx' : 'w' })
  const completion = baseline
    ? 'Complete both record documents and refresh their translation pairing.'
    : `Complete the compatibility and verification prose with --update ${id} --prose FILE.`
  const message = existing === undefined && prose === undefined
    ? `Created ${HISTORY_DIRECTORY}/${id}.md and paired schema files. ${completion}`
    : `${update ? 'Updated' : 'Created'} ${HISTORY_DIRECTORY}/${id}.md; schema artifacts and bilingual pairing are current.`
  return { schemaVersion: 1, ok: true, operation, recordId: id, message,
    changes: differences,
    roots: rootTransitions(history, current), files: outputs.map(file => file.path) }
}

/** Execute tree-only verification or author an explicit persistence acknowledgement.
 * @param args - check, baseline, record, or update arguments; --json selects structured output.
 * @param root - checkout root; defaults to this script's repository.
 * @param extract - current-source extraction function; fixtures supply their own source reader.
 * @param artifacts - renderer for current generated artifacts; fixtures may isolate the inventory artifact.
 * @returns text or one JSON result; JSON failures retain ok:false for the process entry point.
 */
export function runPersistenceChanges(
  args: readonly string[],
  root: string = resolve(import.meta.dirname, '..'),
  extract: (root: string) => PersistenceSchemaInventory = extractPersistenceSchema,
  artifacts: (root: string, current: PersistenceSchemaInventory) => readonly PersistenceArtifact[] = persistenceCatalogArtifacts,
): string {
  try {
    const result = executeCommand(args, root, extract, artifacts)
    return args.includes('--json') ? JSON.stringify(result) : result.message
  } catch (error: unknown) {
    if (!args.includes('--json')) throw error
    const result: CommandResult = { schemaVersion: 1, ok: false, operation: commandOperation(args),
      message: error instanceof Error ? error.message : String(error),
      code: error instanceof PersistenceChangeFailure ? error.code : 'verification-failed',
      changes: error instanceof PersistenceChangeFailure ? error.changes : [],
      roots: error instanceof PersistenceChangeFailure ? error.roots : [], files: [] }
    return JSON.stringify(result)
  }
}
