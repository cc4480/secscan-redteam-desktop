/**
 * Record phase of `verify-translation-pairing`: `--write` stores both blob
 * hashes for the requested complete pairs, creating missing consistency
 * records. The entry barrel owns the CLI contract.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { storeGitBlob } from './translation-pairing-git.ts'
import { renderTranslationPairingRecord, translationPairPaths } from './translation-pairing-record.ts'
import {
  isExcluded,
  readRepositoryFile,
  repositoryFileExists,
  request,
  root,
  sources,
} from './verify-translation-pairing-cli.ts'

/**
 * (Re)record both hashes for the requested complete pairs, creating missing
 * records. A named pair that cannot be recorded (missing counterpart) fails
 * loud; corpus scope (`--all`) skips pairless sources as before.
 * @returns Nothing; the process exits 0 once every record is written.
 */
export function runTranslationPairingWrite(): void {
  let written = 0
  for (const source of sources) {
    if (isExcluded(source)) continue
    const paths = translationPairPaths(source)
    const { zh, meta } = paths
    if (!repositoryFileExists(source) || !repositoryFileExists(zh)) {
      if (request.scope === 'pairs') {
        console.error(`verify-translation-pairing: cannot record ${source}: missing ${repositoryFileExists(source) ? zh : source}`)
        process.exit(2)
      }
      continue
    }
    const sourceContent = readRepositoryFile(source)
    const zhContent = readRepositoryFile(zh)
    if (sourceContent === undefined || zhContent === undefined) throw new Error(`${source}: complete pair became unreadable`)
    // A consistency record is also a recovery pointer for the briefing
    // generator. Persist both snapshots even when the sidecar text is already
    // current, because the bytes may exist only in this working tree.
    const record = renderTranslationPairingRecord(paths, {
      sourceHash: storeGitBlob(root, sourceContent),
      zhHash: storeGitBlob(root, zhContent),
    })
    if (existsSync(join(root, meta)) && readFileSync(join(root, meta), 'utf8') === record) continue
    writeFileSync(join(root, meta), record)
    console.log(`verify-translation-pairing: recorded ${meta}`)
    written++
  }
  console.log(`verify-translation-pairing: ${written} record(s) written; run the check to validate the pairs.`)
  process.exit(0)
}
