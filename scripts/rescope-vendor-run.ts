/**
 * The codemod run: classify every exact edit, apply them, rewrite the generic
 * pass, and verify the post-state. It executes only when the barrel
 * `rescope-vendor.ts` is the process entry point, so importing that barrel for
 * its exported classifier stays side-effect free.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { POSTCONDITIONS } from './rescope-vendor-conditions.ts'
import { EXACT_EDITS } from './rescope-vendor-edits.ts'
import { exactEditState } from './rescope-vendor-exact-state.ts'
import { isRescopeExcluded } from './rescope-vendor-excluded.ts'
import { classify, patterns, rewrite } from './rescope-vendor-rewrite.ts'
import type { ExactEdit } from './rescope-vendor-types.ts'

const root = resolve(import.meta.dirname, '..')

function main(): void {
  const args = process.argv.slice(2)
  const mode = args.includes('--apply') ? 'apply' : args.includes('--check') ? 'check' : 'dry'
  const reverse = args.includes('--reverse')
  const all = patterns(reverse)
  // maxBuffer is not optional here: Node's 1 MiB default kills this call with
  // ENOBUFS on a checkout whose tracked-file list exceeds it (observed at ~3 MB),
  // which made --check unusable in the hygiene gate. The list is the input, so
  // the buffer is sized for it with a wide margin.
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0')
    .filter(file => file !== '' && !isRescopeExcluded(file))

  const counts = new Map<string, { files: number; lines: number }>()
  const failures: string[] = []
  const outstanding: string[] = []

  // Classify every exact edit before writing anything: a single invalid site
  // means the mapping and the tree disagree, and a half-applied tree is worse
  // than an untouched one.
  const planned: { edit: ExactEdit; path: string; find: string; replace: string }[] = []
  for (const edit of EXACT_EDITS) {
    const path = resolve(root, edit.file)
    const before = readFileSync(path, 'utf8')
    const find = reverse ? edit.replace : edit.find
    const replace = reverse ? edit.find : edit.replace
    const state = exactEditState(before, find, replace, edit.expect)
    if (state === 'invalid') {
      failures.push(`exact edit ${edit.id}: ${edit.file} is neither pending nor cleanly applied (duplicated, partial, or moved)`)
      continue
    }
    if (mode === 'check') {
      if (state !== 'applied') failures.push(`exact edit ${edit.id} did not land in ${edit.file}`)
      continue
    }
    if (state === 'pending') planned.push({ edit, path, find, replace })
  }
  if (failures.length > 0) {
    for (const failure of failures) console.error(`rescope-vendor: ${failure}`)
    console.error(`rescope-vendor: ${String(failures.length)} problem(s); nothing was written.`)
    process.exitCode = 1
    return
  }
  if (mode === 'apply') {
    // Re-read per edit: two edits can target one file, and a stale snapshot
    // would let the second write discard the first.
    for (const { path, find, replace } of planned) {
      writeFileSync(path, readFileSync(path, 'utf8').split(find).join(replace))
    }
  }

  for (const file of files) {
    const path = resolve(root, file)
    // `git ls-files` reports the INDEX, so a file deleted from the working tree
    // but not yet staged still appears here. Skip it: there is nothing to rewrite,
    // and reading it would abort the whole check on a normal working-tree state.
    if (!existsSync(path)) continue
    const before = readFileSync(path, 'utf8')
    const { text: after, lines } = rewrite(before, file, all)
    if (after === before) continue
    outstanding.push(file)
    const kind = classify(file)
    const current = counts.get(kind) ?? { files: 0, lines: 0 }
    counts.set(kind, { files: current.files + 1, lines: current.lines + lines })
    if (mode === 'apply') writeFileSync(path, after)
  }

  console.log(`rescope-vendor: ${mode}${reverse ? ' --reverse' : ''} over ${String(files.length)} tracked files`)
  for (const kind of [...counts.keys()].sort()) {
    const { files: count, lines } = counts.get(kind) ?? { files: 0, lines: 0 }
    console.log(`  ${kind.padEnd(24)} ${String(count).padStart(4)} file(s), ${String(lines)} line(s)`)
  }

  if (mode !== 'dry') {
    for (const check of POSTCONDITIONS) {
      if (reverse) break
      const path = resolve(root, check.file)
      const hits = existsSync(path) ? readFileSync(path, 'utf8').split(check.text).length - 1 : -1
      if (hits !== check.count) {
        failures.push(`postcondition: ${check.file} has ${String(hits)} occurrence(s) of ${JSON.stringify(check.text)}, expected ${String(check.count)}`)
      }
    }
    // The generic pass above already told us which files would still change,
    // which in check mode is exactly the residue-and-idempotency signal.
    if (mode === 'check') {
      for (const file of outstanding) failures.push(`residue: ${file} still carries a pre-rescope name token`)
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`rescope-vendor: ${failure}`)
    console.error(`rescope-vendor: ${String(failures.length)} problem(s); the mapping or an upstream site moved.`)
    process.exitCode = 1
  } else if (mode === 'check') {
    console.log('rescope-vendor: post-state verified — no residue, every exact edit landed, idempotent.')
  } else if (mode === 'apply') {
    console.log('rescope-vendor: applied. Run `pnpm install`, `pnpm run gen-third-party-notices`, and re-record the touched bilingual pairs.')
  }
}

// Only the barrel is the executable entry point; `--check` and `--apply` invoked
// through it must run, while a spec importing the barrel must not.
const entry = process.argv[1]
if (entry !== undefined && realpathSync(entry) === realpathSync(resolve(import.meta.dirname, 'rescope-vendor.ts'))) {
  main()
}
