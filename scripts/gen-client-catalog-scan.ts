/**
 * The workspace scan: every declared slot and registration call site, the
 * fail-closed checks that keep an unteachable contract out of the catalog, and
 * the projection of validated declarations into entries. Pure wherever the facts
 * can be proven without a workspace.
 */

import { KINDS, MAX_ENTRY_LINES, SCOPES, SCOPE_KIT, SOURCE_GLOBS } from './gen-client-catalog-contract.ts'
import type { SlotEntry } from './gen-client-catalog-contract.ts'
import { entryOf } from './gen-client-catalog-entry.ts'
import { docProse } from './gen-client-catalog-prose.ts'
import {
  indexExportedTypes,
  scanSlotFiles,
  slotDeclarations,
  slotRegistrations,
  standardKitMembers,
} from './slot-walk.ts'
import type { ScannedFile, SlotDeclaration, SlotRegistration, TypeDeclaration } from './slot-walk.ts'

/**
 * Read the workspace and resolve every catalog entry, failing loud on a
 * contract the catalog cannot teach.
 * @param scanRoot - repository root to scan.
 * @returns the entries, sorted by key.
 * @throws when any declared slot is unteachable or the scan contradicts itself.
 */
export function collectSlotEntries(scanRoot: string): SlotEntry[] {
  const files = scanSlotFiles(scanRoot, SOURCE_GLOBS)
  const declarations = files.flatMap(file => slotDeclarations(file))
  const registrations = files.flatMap(file => slotRegistrations(file))
  const types = indexExportedTypes(scanRoot, SOURCE_GLOBS)
  const problems = validateSlotContracts(declarations, registrations, types)
  if (problems.length > 0) {
    throw new Error(`gen-client-catalog: ${String(problems.length)} contract violation(s):\n${problems.map(problem => `  ${problem}`).join('\n')}`)
  }
  const entries = resolveSlotEntries(declarations, registrations, types, standardKits(files))
  const oversized = oversizedSlotReports(entries)
  if (oversized.length > 0) {
    throw new Error(`gen-client-catalog: ${String(oversized.length)} slot(s) exceed the per-slot report budget `
      + `of ${String(MAX_ENTRY_LINES)} lines:\n${oversized.map(problem => `  ${problem}`).join('\n')}`)
  }
  return entries
}

/**
 * Slots whose expanded report exceeds {@link MAX_ENTRY_LINES}. Separated from
 * the scan so the budget is provable on one hand-built entry.
 * @param entries - resolved catalog entries.
 * @returns one message per over-budget slot, empty when every report is readable.
 */
export function oversizedSlotReports(entries: readonly SlotEntry[]): string[] {
  return entries
    .filter(entry => entryLines(entry) > MAX_ENTRY_LINES)
    .map(entry => `slot '${entry.key}' (${entry.source}) reports ${String(entryLines(entry))} lines. `
      + 'Narrow the owner share it passes down (a slot hands a registrant a share, not a subsystem) or tighten '
      + 'its prose, so asking about one slot stays cheaper than asking about all of them.')
}

/** Line count of one entry's variable-length content, the proxy for its rendered report. */
function entryLines(entry: SlotEntry): number {
  const blocks = [entry.doc, entry.example, ...entry.ownerProps, ...entry.registerOptions.map(option => option.doc)]
  return blocks.reduce((total, block) => total + block.split('\n').length, 0)
    + entry.standardProps.length + entry.ownerPropsReferences.length + entry.occupants.length
}

/**
 * Fail-closed contract checks: an unteachable slot must break the gate rather
 * than ship an entry a model cannot act on. Pure, so every rejection is
 * provable without scanning the workspace.
 * @param declarations - every declared slot.
 * @param registrations - every registration call site.
 * @param types - exported type index the owner-props reference resolves against.
 * @returns one message per violation, empty when the surface is teachable.
 */
export function validateSlotContracts(
  declarations: readonly SlotDeclaration[],
  registrations: readonly SlotRegistration[],
  types: ReadonlyMap<string, TypeDeclaration>,
): string[] {
  const problems: string[] = []
  const byKey = new Map<string, SlotDeclaration>()
  for (const declaration of declarations) {
    const where = `slot '${declaration.key}' (${declaration.source})`
    const previous = byKey.get(declaration.key)
    if (previous !== undefined) {
      problems.push(`${where} is also declared at ${previous.source}; SlotMap merges duplicates silently, so the catalog cannot tell which documentation wins.`)
      continue
    }
    byKey.set(declaration.key, declaration)
    if (!(KINDS as readonly string[]).includes(declaration.kind)) {
      problems.push(`${where} has no literal 'kind'; the catalog derives the register options from it, so it must be one of ${KINDS.join('/')}.`)
    }
    if (!(SCOPES as readonly string[]).includes(declaration.scope)) {
      problems.push(`${where} has no literal 'scope'; the catalog derives the framework props from it, so it must be one of ${SCOPES.join('/')}.`)
    }
    if (docProse(declaration.jsDoc) === '') {
      problems.push(`${where} has no JSDoc prose. Write it from the REGISTRANT's side: what to pass, what the component receives, whom a registration replaces, and what absence looks like (packages/client/ui-settings/src/client/contract/slots.ts is the template).`)
    }
    if (declaration.ownerType !== undefined
      && /^[A-Za-z_$][\w$]*$/.test(declaration.ownerType)
      && !types.has(declaration.ownerType)) {
      problems.push(`${where} names owner props '${declaration.ownerType}' that no exported declaration provides; export the interface so the catalog can show what the component receives.`)
    }
  }
  for (const registration of registrations) {
    if (registration.factory !== true && !byKey.has(registration.key)) {
      problems.push(`registration into '${registration.key}' (${registration.source}) targets a slot no SlotMap merge declares; either the scan has a blind spot or the registration is dead.`)
    }
    for (const child of registration.children) {
      if (!byKey.has(child)) {
        problems.push(`registration at ${registration.source} declares child slot '${child}' that no SlotMap merge types.`)
      }
    }
  }
  return problems
}

/**
 * Project validated declarations into catalog entries: cardinality decides the
 * register options, scope decides the framework props, and the registration
 * call sites decide who already sits in the seat and which owner's mount makes
 * it exist. Pure, so the projection facts are provable without a workspace.
 * @param declarations - validated slot declarations.
 * @param registrations - every registration call site.
 * @param types - exported type index for owner-props expansion.
 * @param kits - framework prop seats per scope.
 * @returns the entries, sorted by key.
 */
export function resolveSlotEntries(
  declarations: readonly SlotDeclaration[],
  registrations: readonly SlotRegistration[],
  types: ReadonlyMap<string, TypeDeclaration>,
  kits: ReadonlyMap<string, readonly string[]>,
): SlotEntry[] {
  const declaredBy = new Map<string, SlotRegistration>()
  for (const registration of registrations) {
    for (const child of registration.children) {
      if (!declaredBy.has(child)) declaredBy.set(child, registration)
    }
  }
  return declarations
    .map(declaration => entryOf(declaration, registrations, declaredBy.get(declaration.key), types, kits))
    .sort((left, right) => left.key.localeCompare(right.key))
}

/** The framework prop seats per scope, read from the merged standard-kit interfaces. */
function standardKits(files: readonly ScannedFile[]): ReadonlyMap<string, readonly string[]> {
  const global = standardKitMembers(files, 'GlobalStandardProps')
  const kits = new Map<string, readonly string[]>()
  for (const scope of SCOPES) {
    const extra = SCOPE_KIT[scope]
    kits.set(scope, [...global, ...extra === undefined ? [] : standardKitMembers(files, extra)])
  }
  return kits
}
