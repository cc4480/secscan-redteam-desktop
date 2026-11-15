/** Corpus scope and manifest validation for the pairing gate; the module contract is in `translation-pairing.ts`. */

/** Validated fields of `scripts/translation-pairing.manifest.json`. */
export interface TranslationPairingManifest {
  /** Source documents exempt from pairing because they are generated, instructional, or bilingual by construction. */
  excluded: string[]
}

const README_ARTIFACT = /(?:^|\/)readme(?:\.md|\.zh\.md|\.i18n\.yaml)$/i
const ROOT_PAIRED_DOCUMENT_ARTIFACT = /^(?:brand_guidelines|contributing|safety)(?:\.md|\.zh\.md|\.i18n\.yaml)$/i
const NON_SOURCE_DIRECTORIES = new Set([
  'node_modules',
  'lib',
  '.pnpm-store',
  '.cache',
  'coverage',
  '.sessions',
  '.storages',
  'tmp',
  'dist-exe',
  '__pycache__',
  '.pytest_cache',
  '.artifacts',
  'vendor',
])

/** Glob traversal exclusions corresponding to the non-source path predicate. */
export const TRANSLATION_SCOPE_GLOB_EXCLUDES = [
  '.agents/notes/archived/**',
  '**/node_modules/**',
  '**/lib/**',
  '**/.pnpm-store/**',
  '**/.cache/**',
  '**/coverage/**',
  '**/.doc-typecheck-*/**',
  '**/.node-next-types-*/**',
  '**/.sessions/**',
  '**/.storages/**',
  '**/tmp/**',
  '**/dist-exe/**',
  '**/__pycache__/**',
  '**/.pytest_cache/**',
  'apps/web/dist/**',
  '.artifacts/**',
  'python/sdk-runtime/src/deepseek_harness_runtime/runtime/**',
  'vendor/**',
]

/** Whether a repository-relative path belongs to a dependency or generated tree. */
function isTranslationSourceExcluded(file: string): boolean {
  const segments = file.split('/')
  return segments.some(segment => NON_SOURCE_DIRECTORIES.has(segment)
      || segment.startsWith('.doc-typecheck-')
    || segment.startsWith('.node-next-types-'))
    || file.startsWith('apps/web/dist/')
    || file.startsWith('python/sdk-runtime/src/deepseek_harness_runtime/runtime/')
}

/** Whether one discovered Markdown or sidecar path belongs to the bilingual source corpus. */
export function isTranslationScopeFile(file: string): boolean {
  return !file.startsWith('.agents/notes/archived/')
    && !isTranslationSourceExcluded(file) && (README_ARTIFACT.test(file)
    || ROOT_PAIRED_DOCUMENT_ARTIFACT.test(file)
    || file.startsWith('.agents/notes/')
    || file.startsWith('docs/')
    || file.startsWith('python/'))
}

/** Read the manifest exclusion list or fail before enforcement starts. */
function excludedField(record: Record<string, unknown>): string[] {
  const value = record.excluded
  if (!Array.isArray(value)) {
    throw new Error('translation-pairing.manifest.json: excluded must be an array of strings')
  }
  const entries: unknown[] = value
  if (!entries.every((entry): entry is string => typeof entry === 'string')) {
    throw new Error('translation-pairing.manifest.json: excluded must be an array of strings')
  }
  return entries
}

/** Parse and validate the checked-in bilingual manifest. */
export function parseTranslationPairingManifest(content: string): TranslationPairingManifest {
  const value: unknown = JSON.parse(content)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('translation-pairing.manifest.json: expected an object')
  }
  const record = value as Record<string, unknown>
  const unsupported = Object.keys(record).filter(field => field !== 'excluded')
  if (unsupported.length > 0) {
    throw new Error(`translation-pairing.manifest.json: unsupported field(s): ${unsupported.join(', ')}; every in-scope document is required`)
  }
  return { excluded: excludedField(record) }
}

/** Whether a manifest entry excludes one exact file or a directory subtree. */
export function isTranslationPairingManifestExcluded(
  file: string,
  manifest: TranslationPairingManifest,
): boolean {
  return manifest.excluded.some(entry => (entry.endsWith('/') ? file.startsWith(entry) : file === entry))
}

/** Build the active bilingual-source predicate shared by every link consumer. */
export function translationPairSourcePredicate(
  manifest: TranslationPairingManifest,
): (sourcePath: string) => boolean {
  return sourcePath => isTranslationScopeFile(sourcePath)
    && !isTranslationPairingManifestExcluded(sourcePath, manifest)
}
