/**
 * CLI entry for `scripts/gen-translation-brief.ts`: resolve the requested pairs,
 * brief each drifted side, and drive the exit status.
 */

import { globSync } from 'node:fs'
import { sep } from 'node:path'
import { briefDirection } from './gen-translation-brief-plan.ts'
import { root } from './gen-translation-brief-git.ts'
import { loadPair } from './gen-translation-brief-pairs.ts'
import { isTranslationScopeFile, pairAnchorOfArgument, TRANSLATION_SCOPE_GLOB_EXCLUDES } from './translation-pairing.ts'

/**
 * Print (and under `--apply`, apply) the briefing for the given CLI arguments.
 * @param argv - Arguments after the script path.
 * @returns nothing; every exit path calls `process.exit` or logs the briefs.
 */
export function runBriefCommand(argv: readonly string[]): void {
  const flags = argv.filter(argument => argument.startsWith('--'))
  const unknownFlags = flags.filter(flag => flag !== '--apply')
  if (unknownFlags.length > 0) {
    console.error(`gen-translation-brief: unknown flag(s): ${unknownFlags.join(', ')} (only --apply is supported)`)
    process.exit(2)
  }
  const applyMode = flags.includes('--apply')
  const requested = argv.filter(argument => !argument.startsWith('--')).map(pairAnchorOfArgument)

  let anchors: string[]
  if (requested.length > 0) {
    anchors = [...new Set(requested)].sort()
  } else {
    const discovered = new Set<string>()
    for (const match of globSync('**/*.i18n.yaml', { cwd: root, exclude: TRANSLATION_SCOPE_GLOB_EXCLUDES })) {
      const normalized = match.split(sep).join('/')
      if (isTranslationScopeFile(normalized)) discovered.add(normalized.replace(/\.i18n\.yaml$/, '.md'))
    }
    anchors = [...discovered].sort()
  }

  const briefs: string[] = []
  const problems: string[] = []
  const skipped: string[] = []
  for (const anchor of anchors) {
    const pair = loadPair(anchor)
    if (typeof pair === 'string') {
      if (requested.length > 0) problems.push(pair)
      continue
    }
    if (!pair.enDrifted && !pair.zhDrifted) {
      if (requested.length > 0) skipped.push(`${anchor}: pair is consistent with its record — nothing to brief`)
      continue
    }
    if (pair.enDrifted) briefs.push(briefDirection(pair, 'en-to-zh', applyMode))
    if (pair.zhDrifted) briefs.push(briefDirection(pair, 'zh-to-en', applyMode))
  }

  if (problems.length > 0 || skipped.length > 0) {
    for (const message of [...problems, ...skipped]) console.error(`gen-translation-brief: ${message}`)
    process.exit(2)
  }
  if (briefs.length === 0) {
    console.log('gen-translation-brief: every recorded pair matches its consistency record; nothing to brief.')
    process.exit(0)
  }
  console.log(briefs.join('\n\n---\n\n'))
}
