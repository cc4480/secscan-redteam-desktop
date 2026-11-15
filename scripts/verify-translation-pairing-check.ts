/**
 * Verification phase of `verify-translation-pairing`: completeness, recorded
 * hash agreement, locale-link targets, generated-region bytes, language
 * switchers and structural signatures for every in-scope pair — plus the
 * `--list` state report. The entry barrel owns the CLI contract.
 */

import { basename } from 'node:path'
import { gitBlobHash } from './translation-pairing-git.ts'
import {
  parseTranslationPairingRecord,
  translationPairPaths,
} from './translation-pairing-record.ts'
import {
  hasLanguageSwitcher,
  normalizeTranslationMarkdownLinks,
  translationLinkLocaleViolations,
} from './translation-links.ts'
import {
  languageSwitcherTargets,
  parseTranslationMarkdown,
  partitionGeneratedRegions,
  requiresSourceLanguageSwitcher,
  translationStructureDiff,
  translationStructureSignature,
} from './translation-pairing.ts'
import {
  indexMode,
  isExcluded,
  isTranslationPairSource,
  listMode,
  metas,
  readRepositoryFile,
  repositoryFileExists,
  request,
  root,
  sources,
  translations,
} from './verify-translation-pairing-cli.ts'

/**
 * Enforce pairing rules across the enumerated scope and exit with the verdict:
 * 0 when every pair is consistent, 1 with one line per violation, or 0 after
 * printing the `--list` state report.
 * @returns Nothing; the process exits with the check outcome.
 */
export function runTranslationPairingCheck(): void {
  const errors: string[] = []
  const state = new Map<string, 'ok' | 'out-of-sync' | 'missing'>()

  // 1. Every discovered, non-excluded source merges bilingual.
  for (const source of sources) {
    if (isExcluded(source)) continue
    const { zh } = translationPairPaths(source)
    if (!repositoryFileExists(zh)) {
      errors.push(`${source}: in-scope documentation must merge bilingual (docs/i18n/README.md); add the counterpart and record the pair`)
      state.set(source, 'missing')
    }
  }

  // 2. Every pair that exists at all is complete and consistent. Anchor on the
  // union of .zh.md files and .i18n.yaml records so a half-deleted pair is
  // caught from either remnant.
  const pairAnchors = new Set<string>()
  for (const zh of translations) pairAnchors.add(zh.replace(/\.zh\.md$/, '.md'))
  for (const meta of metas) pairAnchors.add(meta.replace(/\.i18n\.yaml$/, '.md'))

  for (const source of [...pairAnchors].sort()) {
    const paths = translationPairPaths(source)
    const { zh, meta } = paths
    const have = {
      source: repositoryFileExists(source),
      zh: repositoryFileExists(zh),
      meta: repositoryFileExists(meta),
    }

    if (isExcluded(source)) {
      if (have.zh) errors.push(`${zh}: ${source} is excluded from pairing (generated or bilingual-by-construction); this translation must not exist`)
      if (have.meta) errors.push(`${meta}: ${source} is excluded from pairing; this consistency record must not exist`)
      continue
    }
    const missing = Object.entries(have).filter(([, ok]) => !ok).map(([k]) => (k === 'source' ? source : k === 'zh' ? zh : meta))
    if (missing.length > 0) {
      errors.push(`${source}: incomplete pair — missing ${missing.join(', ')} (pairs merge whole: both languages plus the .i18n.yaml record)`)
      continue
    }

    const sourceContent = readRepositoryFile(source)
    const zhContent = readRepositoryFile(zh)
    const metaContent = readRepositoryFile(meta)
    if (sourceContent === undefined || zhContent === undefined || metaContent === undefined) {
      throw new Error(`${source}: complete pair became unreadable`)
    }
    const record = parseTranslationPairingRecord(metaContent.toString('utf8'), paths)
    if (record === undefined) {
      errors.push(`${meta}: malformed consistency record (expected exactly \`${basename(source)}: <40-hex>\` and \`${basename(zh)}: <40-hex>\`)`)
      continue
    }

    let consistent = true
    for (const [file, content] of [[source, sourceContent], [zh, zhContent]] as const) {
      const current = gitBlobHash(content)
      const recorded = file === source ? record.sourceHash : record.zhHash
      if (recorded !== current) {
        errors.push(`${file}: out of sync — content no longer matches the pair's last confirmed-consistent state in ${meta} (bring the other side along, then re-record with --write)`)
        consistent = false
      }
    }
    if (!consistent) {
      state.set(source, 'out-of-sync')
      continue
    }

    const sourceText = sourceContent.toString('utf8')
    const zhText = zhContent.toString('utf8')
    const sourceSwitcherTargets = languageSwitcherTargets(source)
    const zhSwitcherTargets = languageSwitcherTargets(zh)
    for (const violation of [
      ...translationLinkLocaleViolations(sourceText, {
        repoRoot: root,
        sourcePath: source,
        isTranslationPairSource,
        repositoryFileExists,
      }, zhSwitcherTargets),
      ...translationLinkLocaleViolations(zhText, {
        repoRoot: root,
        sourcePath: zh,
        isTranslationPairSource,
        repositoryFileExists,
      }, sourceSwitcherTargets),
    ]) {
      errors.push(`${violation.sourcePath}:${violation.line}: link target ${JSON.stringify(violation.url)} uses the wrong locale; expected ${JSON.stringify(violation.expectedUrl)}`)
      state.set(source, 'out-of-sync')
    }

    // Generated regions must remain byte-identical after paired document paths
    // are normalized to one semantic target. The structural signature below
    // compares their contents again as part of the whole document; this named
    // check rejects any prose, ordering, code, marker, or non-locale URL drift.
    let sourceRegions: { regions: string[]; stripped: string }
    let zhRegions: { regions: string[]; stripped: string }
    try {
      sourceRegions = partitionGeneratedRegions(sourceText)
      zhRegions = partitionGeneratedRegions(zhText)
    } catch (error) {
      errors.push(`${source} ↔ ${zh}: ${error instanceof Error ? error.message : String(error)}`)
      state.set(source, 'out-of-sync')
      continue
    }
    const normalizedSourceRegions = sourceRegions.regions.map(region => normalizeTranslationMarkdownLinks(region, {
      repoRoot: root,
      sourcePath: source,
      isTranslationPairSource,
      repositoryFileExists,
    }))
    const normalizedZhRegions = zhRegions.regions.map(region => normalizeTranslationMarkdownLinks(region, {
      repoRoot: root,
      sourcePath: zh,
      isTranslationPairSource,
      repositoryFileExists,
    }))
    if (normalizedSourceRegions.length !== normalizedZhRegions.length
      || normalizedSourceRegions.some((region, index) => region !== normalizedZhRegions[index])) {
      errors.push(`${source} ↔ ${zh}: generated regions differ beyond paired-document locale paths — regenerate both sides`)
      state.set(source, 'out-of-sync')
    }

    const sourceTree = parseTranslationMarkdown(sourceText)
    const zhTree = parseTranslationMarkdown(zhText)
    if (!hasLanguageSwitcher(zhTree, zhText, sourceSwitcherTargets)) {
      errors.push(`${zh}: missing language switcher — no link to ${basename(source)}`)
    }
    if (requiresSourceLanguageSwitcher(source) && !hasLanguageSwitcher(sourceTree, sourceText, zhSwitcherTargets)) {
      errors.push(`${source}: missing language switcher — no link back to ${basename(zh)}`)
    }
    for (const divergence of translationStructureDiff(
      translationStructureSignature(sourceTree, zhSwitcherTargets, {
        repoRoot: root,
        sourcePath: source,
        isTranslationPairSource,
        repositoryFileExists,
        markdown: sourceText,
      }),
      translationStructureSignature(zhTree, sourceSwitcherTargets, {
        repoRoot: root,
        sourcePath: zh,
        isTranslationPairSource,
        repositoryFileExists,
        markdown: zhText,
      }),
    )) {
      errors.push(`${source} ↔ ${zh}: ${divergence}`)
    }
    if (!state.has(source)) state.set(source, 'ok')
  }

  // Complete the state map for --list: any in-scope, non-excluded document with no pair is missing.
  for (const source of sources) {
    if (!isExcluded(source) && !state.has(source)) state.set(source, 'missing')
  }

  if (listMode) {
    const order = { 'out-of-sync': 0, missing: 1, ok: 2 } as const
    const rows = [...state.entries()].sort((a, b) => order[a[1]] - order[b[1]] || a[0].localeCompare(b[0]))
    for (const [file, status] of rows) {
      console.log(`${status.padEnd(11)} ${file}${status === 'missing' ? '  (required)' : ''}`)
    }
    const counts = { 'ok': 0, 'out-of-sync': 0, 'missing': 0 }
    for (const status of state.values()) counts[status]++
    console.log(`verify-translation-pairing: ${counts.ok} ok, ${counts['out-of-sync']} out-of-sync, ${counts.missing} missing (of ${state.size} in scope)`)
    process.exit(0)
  }

  if (errors.length === 0) {
    console.log(request.scope === 'pairs'
      ? `verify-translation-pairing: ${pairAnchors.size} named ${indexMode ? 'staged ' : ''}pair(s) consistent; the corpus-wide check still runs in doc-sync.`
      : `verify-translation-pairing: ${pairAnchors.size} pair(s) checked across all in-scope documentation, all consistent.`)
    process.exit(0)
  }

  console.error('verify-translation-pairing: bilingual pairing rules violated (see docs/i18n/README.md):')
  for (const message of errors) console.error(`  ${message}`)
  process.exit(1)
}
