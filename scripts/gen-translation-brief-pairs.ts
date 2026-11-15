/**
 * Pair state for `scripts/gen-translation-brief.ts`: the pairing manifest, the
 * terminology table, and one pair's recorded and current text.
 */

import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { blobText, parseMeta, root } from './gen-translation-brief-git.ts'
import {
  isTranslationPairingManifestExcluded,
  isTranslationScopeFile,
  parseTranslationPairingManifest,
  translationPairSourcePredicate,
} from './translation-pairing.ts'

const manifest = parseTranslationPairingManifest(readFileSync(join(root, 'scripts/translation-pairing.manifest.json'), 'utf8'))

/** Whether a path is a pair source, per the pairing manifest. */
export const isTranslationPairSource = translationPairSourcePredicate(manifest)

/** The shared terminology table every brief is matched against. */
export const terminology = readFileSync(join(root, 'docs/i18n/terminology.md'), 'utf8')

function isExcluded(file: string): boolean {
  return isTranslationPairingManifestExcluded(file, manifest)
}

/** One pair's recorded and current state, with drift per side. */
export interface PairState {
  anchor: string
  zh: string
  meta: string
  enDrifted: boolean
  zhDrifted: boolean
  enLast: string
  zhLast: string
}

/** Load one pair's recorded and current state, or explain why it cannot be briefed. */
export function loadPair(anchor: string): PairState | string {
  const zh = anchor.replace(/\.md$/, '.zh.md')
  const meta = anchor.replace(/\.md$/, '.i18n.yaml')
  if (!isTranslationScopeFile(anchor) || isExcluded(anchor)) {
    return `${anchor}: not an in-scope documentation pair (docs/i18n/README.md)`
  }
  const missing = [anchor, zh, meta].filter(file => !existsSync(join(root, file)))
  if (missing.length > 0) {
    return `${anchor}: incomplete pair (missing ${missing.join(', ')}) — a new counterpart is whole-document translation work, not a minimal update`
  }
  const record = parseMeta(readFileSync(join(root, meta), 'utf8'))
  const enRecorded = record?.get(basename(anchor))
  const zhRecorded = record?.get(basename(zh))
  if (record === undefined || enRecorded === undefined || zhRecorded === undefined) {
    return `${meta}: malformed consistency record`
  }
  const enCurrent = readFileSync(join(root, anchor), 'utf8')
  const zhCurrent = readFileSync(join(root, zh), 'utf8')
  const enLast = blobText(enRecorded)
  const zhLast = blobText(zhRecorded)
  return {
    anchor,
    zh,
    meta,
    enDrifted: enCurrent !== enLast,
    zhDrifted: zhCurrent !== zhLast,
    enLast,
    zhLast,
  }
}
