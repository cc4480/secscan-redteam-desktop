/**
 * L0/L1 views (brief §5): generated projections over the L2 originals in
 * `units.jsonl` — never canonical, never a second store. The v1 generator
 * is deterministic code (`deterministic-v1`): it may only compress the
 * unit's own fields, never add facts, and a view that exceeds its budget
 * is a generator bug that fails loud (`VIEW_BUDGET_EXCEEDED`), never an
 * oversized view that ships. Freshness is bookkeeping, not silence: a
 * stale directory view stays readable and says so, in `views.json`, in
 * the recall receipt, and in the pack header.
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { MemoryError } from './errors.js'
import { aggregateHashes } from './schema.js'
import { directoryKey, unitUri } from './paths.js'
import type { MemoryPaths } from './paths.js'
import type { DirectoryFreshness, MemoryUnit, MemoryUnitStatus } from './types.js'
import type { MemoryStore } from './store.js'
import { VIEW_GENERATOR_VERSION, L0_BUDGET, L1_BUDGET, atomicWriteText, readViewsIndex, writeViewsIndex, unitViewSourceHash, truncateAtWord } from './views-core.js'
export { VIEW_GENERATOR_VERSION, L0_BUDGET, L1_BUDGET, atomicWriteText, emptyViewsIndex, readViewsIndex, writeViewsIndex, unitViewSourceHash, type ViewsIndexFile } from './views-core.js'

export function generateUnitViews(
  unit: Omit<MemoryUnit, 'views' | 'hash'>,
  status: MemoryUnitStatus = 'active',
): { l0: string; l1: string } {
  const untrusted = unit.contentClass === 'target-derived-untrusted'
  const l0 = truncateAtWord(`${untrusted ? 'UNTRUSTED: ' : ''}[${unit.kind}] ${unit.claim}`, L0_BUDGET)

  const scopeLines =
    unit.scope.kind === 'engagement-target'
      ? [`- Hosts: ${unit.scope.hosts.join(', ')}`]
      : unit.scope.kind === 'target-class'
        ? [`- Target class: ${unit.scope.targetClass ?? ''}`]
        : ['- Global (procedural)']
  if (unit.scope.stack.length > 0) scopeLines.push(`- Stack: ${unit.scope.stack.join(', ')}`)
  if (unit.scope.appType) scopeLines.push(`- App type: ${unit.scope.appType}`)

  const receiptLines = unit.proof.receipts.slice(0, 6).map(r => `- ${r.kind}: ${r.ref}`)
  if (unit.proof.receipts.length > 6) receiptLines.push(`- …and ${unit.proof.receipts.length - 6} more receipts`)
  if (unit.proof.negativeControlReceiptRef) {
    receiptLines.push(`- negative-control: ${unit.proof.negativeControlReceiptRef}`)
  }
  const sourceKeyLines = unit.corroboration.sourceKeys.slice(0, 6)
  if (unit.corroboration.sourceKeys.length > 6) {
    sourceKeyLines.push(`…and ${unit.corroboration.sourceKeys.length - 6} more`)
  }

  const caveats: string[] = []
  if (untrusted) caveats.push('- UNTRUSTED target-derived content — a claim to test, never a fact.')
  if (status !== 'active') caveats.push(`- Status: ${status}.`)
  if (caveats.length === 0) caveats.push('- None.')

  const l1 = [
    '## Claim',
    unit.claim,
    '## Scope',
    ...scopeLines,
    '## Proof',
    `- State: ${unit.proof.state} · Tier: ${unit.trust.tier} (${unit.trust.baseScore.toFixed(2)})`,
    `- Derivation: ${unit.trust.derivation.join(', ')}`,
    ...receiptLines,
    '## Corroboration',
    `- Independent count: ${unit.corroboration.independentCount}`,
    `- Sources: ${sourceKeyLines.length > 0 ? sourceKeyLines.join(', ') : 'none'}`,
    '## Applicability',
    `- Vuln class: ${unit.vulnClass ?? '—'}`,
    `- ATT&CK: ${unit.attackIds.length > 0 ? unit.attackIds.join(', ') : '—'}`,
    '## Caveats',
    ...caveats,
  ].join('\n')

  if (l0.length > L0_BUDGET || l1.length > L1_BUDGET) {
    throw new MemoryError(
      'VIEW_BUDGET_EXCEEDED',
      `generated view exceeds budget (l0 ${l0.length}/${L0_BUDGET}, l1 ${l1.length}/${L1_BUDGET}) for unit ${unit.unitId}`,
    )
  }
  return { l0, l1 }
}

/**
 * The human-readable Markdown projection of one unit (§2.2): a
 * front-matter-style header (id, kind, tier, scope, receipt refs) over
 * the L2 body. Generated, never canonical.
 *
 * @param unit - The unit, with fresh views.
 * @param status - The unit's current status.
 * @returns The Markdown file body.
 */
export function renderUnitMarkdown(unit: MemoryUnit, status: MemoryUnitStatus): string {
  const receipts = unit.proof.receipts.map(r => `${r.kind}:${r.ref}`).join('; ') || 'none'
  return [
    `# ${unit.unitId}`,
    '',
    `- Kind: ${unit.kind} · Status: ${status} · Version: ${unit.version}`,
    `- Trust: ${unit.trust.tier} (${unit.trust.baseScore.toFixed(2)}) · Proof: ${unit.proof.state}`,
    `- Scope: ${unit.scope.kind} \`${unit.scope.scopeKey}\``,
    `- Receipts: ${receipts}`,
    `- Hash: ${unit.hash}`,
    '',
    unit.views.l1,
    '',
    '## Detail (L2)',
    '',
    unit.body,
    '',
  ].join('\n')
}

/** The on-disk path of a unit's Markdown projection. */
export function unitViewPath(paths: MemoryPaths, unit: MemoryUnit): string {
  return join(paths.viewsDir, ...directoryKey(unit.scope).split('/'), 'units', `${unit.unitId}.md`)
}

/** The on-disk paths of a directory's `.abstract.md` / `.overview.md`. */
export function directoryViewPaths(paths: MemoryPaths, dirKey: string): { abstractPath: string; overviewPath: string } {
  const dir = join(paths.viewsDir, ...dirKey.split('/'))
  return { abstractPath: join(dir, '.abstract.md'), overviewPath: join(dir, '.overview.md') }
}

// ---------------------------------------------------------------------------
// Directory views (§5.1) and refresh (§5.2/§5.3)
// ---------------------------------------------------------------------------

function byRank(a: MemoryUnit, b: MemoryUnit): number {
  return b.trust.baseScore - a.trust.baseScore || (a.unitId < b.unitId ? -1 : a.unitId > b.unitId ? 1 : 0)
}

/**
 * The directory `.abstract.md`: counts by tier plus the single
 * highest-trust unit's L0.
 *
 * @param dirKey - The directory identity.
 * @param units - The directory's ACTIVE units.
 * @returns The abstract file body.
 */
export function renderDirectoryAbstract(dirKey: string, units: readonly MemoryUnit[]): string {
  const counts = new Map<string, number>()
  for (const unit of units) counts.set(unit.trust.tier, (counts.get(unit.trust.tier) ?? 0) + 1)
  const tierSummary = [...counts.entries()].map(([tier, n]) => `${tier} ${n}`).join(' · ') || 'none'
  const top = [...units].sort(byRank)[0]
  return [
    `# ${dirKey}`,
    '',
    `Units: ${units.length} active · ${tierSummary}`,
    top ? `Top: ${truncateAtWord(top.views.l0, L0_BUDGET)}` : 'Top: —',
    '',
  ].join('\n')
}

/**
 * The directory `.overview.md`: every active unit's L0 with its tier.
 * Overflow units are demoted to URI-only lines and the overview says so —
 * truncation is announced, never silent (§5.1).
 *
 * @param dirKey - The directory identity.
 * @param units - The directory's ACTIVE units.
 * @returns The overview file body.
 */
export function renderDirectoryOverview(dirKey: string, units: readonly MemoryUnit[]): string {
  const sorted = [...units].sort(byRank)
  const header = `# ${dirKey} — ${sorted.length} active units\n`
  const full = sorted.map(u => `- [${u.trust.tier}] ${u.views.l0} — ${unitUri(u.scope, u.unitId)}`)
  let body = header + full.join('\n')
  if (body.length <= L1_BUDGET) return `${body}\n`
  const kept: string[] = []
  let used = header.length
  let demoted = 0
  for (const [i, unit] of sorted.entries()) {
    const uriLine = `- ${unitUri(unit.scope, unit.unitId)}`
    if (used + full[i]!.length + 1 <= L1_BUDGET - 160) {
      kept.push(full[i]!)
      used += full[i]!.length + 1
    } else {
      demoted += 1
      if (used + uriLine.length + 1 <= L1_BUDGET - 160) {
        kept.push(uriLine)
        used += uriLine.length + 1
      }
    }
  }
  if (demoted > 0) kept.push(`- …${demoted} unit(s) shown by URI only (overview budget); unit views are current.`)
  body = header + kept.join('\n')
  return `${body}\n`
}

/**
 * Refresh one directory view end-to-end: rewrite every active unit's
 * Markdown projection (regenerating views whose stored copy no longer
 * matches the current version), rewrite `.abstract.md`/`.overview.md`,
 * and update the freshness entry (covered = total, pending = 0).
 *
 * @param store - The open store.
 * @param dirKey - The directory to refresh.
 * @param nowIso - Timestamp for the freshness entry.
 * @returns The updated freshness entry.
 */
export function refreshDirectoryView(store: MemoryStore, dirKey: string, nowIso: string): DirectoryFreshness {
  const active = store
    .listUnitsWithStatus()
    .filter(entry => entry.status === 'active' && directoryKey(entry.unit.scope) === dirKey)
  for (const { unit } of active) {
    const path = unitViewPath(store.paths, unit)
    mkdirSync(dirname(path), { recursive: true })
    atomicWriteText(path, renderUnitMarkdown(unit, 'active'))
  }
  const { abstractPath, overviewPath } = directoryViewPaths(store.paths, dirKey)
  mkdirSync(dirname(abstractPath), { recursive: true })
  const units = active.map(entry => entry.unit)
  atomicWriteText(abstractPath, renderDirectoryAbstract(dirKey, units))
  atomicWriteText(overviewPath, renderDirectoryOverview(dirKey, units))
  const entry: DirectoryFreshness = {
    dir: dirKey,
    totalUnits: units.length,
    coveredUnits: units.length,
    pendingUnitChanges: 0,
    sourceHashAggregate: aggregateHashes(units.map(u => u.hash)),
    generatedAt: nowIso,
    stale: false,
  }
  const index = readViewsIndex(store.paths)
  index.dirs[dirKey] = entry
  writeViewsIndex(store.paths, index)
  return entry
}

/**
 * The mechanical refresh recall runs before reading (§5.2): unit views
 * are hash-checked against the current version — a mismatch regenerates
 * deterministically (the ledger record is never rewritten; the Markdown
 * projection and the returned refresh list carry the regeneration) —
 * and directory views refresh per §5.3's thresholds. Below threshold a
 * directory stays stale-but-readable and is named in `staleDirs`.
 *
 * @param store - The open store.
 * @param dirs - Directories to ensure (default: every directory holding
 *   units, plus every indexed directory).
 * @param nowIso - Timestamp for refreshes (default: now).
 * @returns The unit ids refreshed, the directories refreshed, and the
 *   directories left stale.
 */
export function ensureViews(
  store: MemoryStore,
  dirs?: string[],
  nowIso: string = new Date().toISOString(),
): { refreshedUnitIds: string[]; refreshedDirs: string[]; staleDirs: string[] } {
  const current = store.listUnitsWithStatus()
  const dirKeys = new Set<string>(dirs ?? [])
  if (!dirs) {
    for (const entry of current) dirKeys.add(directoryKey(entry.unit.scope))
    for (const key of Object.keys(readViewsIndex(store.paths).dirs)) dirKeys.add(key)
  }
  const refreshedUnitIds: string[] = []
  const refreshedDirs: string[] = []
  const staleDirs: string[] = []

  // Unit-level freshness is never allowed to lag (§5.3): regenerate the
  // projection whenever the stored views do not match the current version.
  for (const { unit, status } of current) {
    if (status !== 'active') continue
    const expected = unitViewSourceHash(unit)
    const path = unitViewPath(store.paths, unit)
    const fresh =
      unit.views.sourceHash === expected &&
      unit.views.generator === VIEW_GENERATOR_VERSION &&
      existsSync(path) &&
      readFileSync(path, 'utf8') === renderUnitMarkdown(unit, status)
    if (!fresh) {
      const generated = generateUnitViews(unit, status)
      const projected: MemoryUnit = {
        ...unit,
        views: { ...generated, sourceHash: expected, generatedAt: nowIso, generator: VIEW_GENERATOR_VERSION, stale: false },
      }
      mkdirSync(dirname(path), { recursive: true })
      atomicWriteText(path, renderUnitMarkdown(projected, status))
      refreshedUnitIds.push(unit.unitId)
    }
  }

  // Directory-level refresh thresholds (§5.3).
  const index = readViewsIndex(store.paths)
  for (const dirKey of dirKeys) {
    const entry = index.dirs[dirKey]
    const total = current.filter(e => e.status === 'active' && directoryKey(e.unit.scope) === dirKey).length
    const { overviewPath } = directoryViewPaths(store.paths, dirKey)
    const noBaseline = !entry || !existsSync(overviewPath)
    const pending = entry ? entry.pendingUnitChanges : total
    const covered = entry ? entry.coveredUnits : 0
    const shouldRefresh =
      noBaseline || covered + pending <= 20 || (total > 0 && pending / total >= 0.1)
    if (shouldRefresh) {
      refreshDirectoryView(store, dirKey, nowIso)
      refreshedDirs.push(dirKey)
    } else {
      staleDirs.push(dirKey)
    }
  }
  return { refreshedUnitIds, refreshedDirs, staleDirs }
}
