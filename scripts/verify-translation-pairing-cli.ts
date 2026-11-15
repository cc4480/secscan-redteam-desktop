/**
 * Setup shared by every `verify-translation-pairing` phase: the CLI request, the
 * selected content plane (worktree or git index), the exclusion manifest, and
 * the one-time in-scope corpus enumeration. The entry barrel owns the CLI
 * contract and the owning documentation reference.
 */

import { existsSync, globSync, readFileSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { gitIndexPaths, readGitIndexBlob } from './translation-pairing-git.ts'
import { translationPairPaths } from './translation-pairing-record.ts'
import {
  isTranslationPairingManifestExcluded,
  isTranslationScopeFile,
  parseTranslationPairingCliArgs,
  parseTranslationPairingManifest,
  TRANSLATION_SCOPE_GLOB_EXCLUDES,
  translationPairSourcePredicate,
} from './translation-pairing.ts'

/** Repository root every content-plane path resolves against. */
export const root = resolve(import.meta.dirname, '..')

/** Parse the invocation, exiting 2 with the usage message on invalid arguments. */
function parseRequest(): ReturnType<typeof parseTranslationPairingCliArgs> {
  try {
    return parseTranslationPairingCliArgs(process.argv.slice(2))
  } catch (error) {
    console.error(`verify-translation-pairing: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(2)
  }
}

/** Parsed CLI request; this module does not return when the request is invalid. */
export const request = parseRequest()

/** Whether the run reports per-pair state instead of enforcing it. */
export const listMode = request.mode === 'list'

/** Whether the run records pairs instead of checking them. */
export const writeMode = request.mode === 'write'

/** Whether content comes from the git index rather than the worktree. */
export const indexMode = request.input === 'index'

const indexFiles = indexMode ? gitIndexPaths(root) : undefined

const contentCache = new Map<string, Buffer | undefined>()

/** Read one repository path from the selected worktree or index plane. */
export function readRepositoryFile(file: string): Buffer | undefined {
  if (contentCache.has(file)) return contentCache.get(file)
  const content = indexMode
    ? indexFiles?.has(file) ? readGitIndexBlob(root, file)?.content : undefined
    : existsSync(join(root, file)) && statSync(join(root, file)).isFile()
      ? readFileSync(join(root, file))
      : undefined
  contentCache.set(file, content)
  return content
}

/** Whether one path exists in the selected content plane. */
export function repositoryFileExists(file: string): boolean {
  return indexMode ? indexFiles?.has(file) === true : readRepositoryFile(file) !== undefined
}

/** Discover source Markdown and pairing sidecars before applying the corpus predicate. */
const SCOPE_PATTERNS = [
  '**/*.md',
  '**/*.i18n.yaml',
  '.agents/notes/**/*.md',
  '.agents/notes/**/*.i18n.yaml',
]

const manifestContent = readRepositoryFile('scripts/translation-pairing.manifest.json')
if (manifestContent === undefined) {
  throw new Error('scripts/translation-pairing.manifest.json is missing from the selected content plane')
}
const manifest = parseTranslationPairingManifest(manifestContent.toString('utf8'))

/** Whether one path is an in-scope pairing source under the recorded manifest. */
export const isTranslationPairSource = translationPairSourcePredicate(manifest)

/**
 * An excluded entry ending in `/` excludes the whole directory. The trailing
 * slash IS the path boundary — `docs/tool-catalog/` cannot prefix-match a
 * sibling like `docs/tool-catalog-notes/x.md` — so directory entries in the
 * manifest must keep their trailing slash.
 */
export function isExcluded(file: string): boolean {
  return isTranslationPairingManifestExcluded(file, manifest)
}

// Enumerate the scope once: the whole corpus, or exactly the named pairs'
// three files (a named pair whose files are absent is caught by the same
// completeness rules that cover discovered remnants).
const files = new Set<string>()
if (request.scope === 'pairs') {
  for (const anchor of request.anchors) {
    const { source, zh, meta } = translationPairPaths(anchor)
    for (const file of [source, zh, meta]) {
      if (repositoryFileExists(file)) files.add(file)
    }
    // A named worktree anchor with no files still enters the source list so
    // an interactive check reports it. An index check accepts a complete
    // three-file deletion and still rejects every partial deletion below.
    if (!indexMode && !repositoryFileExists(anchor)) files.add(anchor)
  }
} else {
  for (const pattern of SCOPE_PATTERNS) {
    for (const match of globSync(pattern, { cwd: root, exclude: TRANSLATION_SCOPE_GLOB_EXCLUDES })) {
      const normalized = match.split(sep).join('/')
      if (isTranslationScopeFile(normalized)) files.add(normalized)
    }
  }
}

/** Discovered in-scope counterparts, sorted. */
export const translations = [...files].filter(f => f.endsWith('.zh.md')).sort()

/** Discovered in-scope consistency records, sorted. */
export const metas = [...files].filter(f => f.endsWith('.i18n.yaml')).sort()

/** Discovered in-scope pairing sources, sorted. */
export const sources = [...files].filter(f => f.endsWith('.md') && !f.endsWith('.zh.md')).sort()

if (request.scope === 'pairs') {
  const rejected = request.anchors.filter(anchor => !isTranslationScopeFile(anchor) || isExcluded(anchor))
  const absent = request.anchors.filter((anchor) => {
    const { source, zh, meta } = translationPairPaths(anchor)
    return ![source, zh, meta].some(repositoryFileExists)
  })
  if (rejected.length > 0 || (!indexMode && absent.length > 0)) {
    for (const anchor of rejected) {
      console.error(`verify-translation-pairing: ${anchor} is not an in-scope pair (excluded or outside the documentation corpus; see docs/i18n/README.md)`)
    }
    for (const anchor of absent) {
      console.error(`verify-translation-pairing: ${anchor} names no pair on disk (none of its three files exist)`)
    }
    process.exit(2)
  }
}
