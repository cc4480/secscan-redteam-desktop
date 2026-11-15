/** `verify-translation-pairing` argument parsing; the module contract is in `translation-pairing.ts`. */

/**
 * Normalize one CLI pair argument to its English anchor path: any of the
 * pair's three files (`foo.md`, `foo.zh.md`, `foo.i18n.yaml`) or the bare
 * `foo` stem names the same pair, and platform separators are accepted.
 *
 * @param argument - Repo-relative path as passed on a command line.
 * @returns The pair's `foo.md` anchor path with `/` separators.
 */
export function pairAnchorOfArgument(argument: string): string {
  const normalized = argument.split('\\').join('/').replace(/^\.\//, '')
  if (normalized.endsWith('.zh.md')) return `${normalized.slice(0, -'.zh.md'.length)}.md`
  if (normalized.endsWith('.i18n.yaml')) return `${normalized.slice(0, -'.i18n.yaml'.length)}.md`
  if (normalized.endsWith('.md')) return normalized
  return `${normalized}.md`
}

/** A parsed `verify-translation-pairing` invocation. */
export interface TranslationPairingCliRequest {
  /** Content plane read by the check. Writes and corpus checks use the working tree. */
  input: 'worktree' | 'index'
  mode: 'check' | 'list' | 'write'
  /** `corpus` runs discovery over the whole tree; `pairs` touches only the named anchors. */
  scope: 'corpus' | 'pairs'
  /** English anchor paths, empty for corpus scope. */
  anchors: string[]
}

/**
 * Parse and validate `verify-translation-pairing` CLI arguments.
 *
 * Check accepts optional pair paths; `--write` requires either pair paths or
 * `--all` so a bulk re-record is always an explicit choice — a bare
 * `--write` would silently bless every drifted pair in the tree, including
 * ones the caller never confirmed. `--list` is corpus-only.
 *
 * @param argv - Arguments after the script name.
 * @returns The validated request.
 * @throws Error when flags or their combination are invalid.
 */
export function parseTranslationPairingCliArgs(argv: string[]): TranslationPairingCliRequest {
  const flags = argv.filter(argument => argument.startsWith('--'))
  const anchors = [...new Set(argv.filter(argument => !argument.startsWith('--')).map(pairAnchorOfArgument))].sort()
  const unknown = flags.filter(flag => !['--list', '--write', '--all', '--cached'].includes(flag))
  if (unknown.length > 0) throw new Error(`unknown flag(s): ${unknown.join(', ')}`)
  const listMode = flags.includes('--list')
  const writeMode = flags.includes('--write')
  const allMode = flags.includes('--all')
  const cachedMode = flags.includes('--cached')
  if (listMode && (writeMode || allMode || cachedMode || anchors.length > 0)) {
    throw new Error('--list reports the whole corpus and takes no other flags or paths')
  }
  if (allMode && !writeMode) throw new Error('--all only applies to --write')
  if (cachedMode && writeMode) throw new Error('--cached is a read-only index check and cannot be combined with --write')
  if (cachedMode && anchors.length === 0) throw new Error('--cached requires the staged pair paths to check')
  if (writeMode) {
    if (anchors.length > 0 && allMode) throw new Error('--write takes either pair paths or --all, not both')
    if (anchors.length === 0 && !allMode) {
      throw new Error('--write requires the pair(s) you confirmed (any file of a pair), or --all to re-record every complete pair; recording pairs you did not review blesses unconfirmed content')
    }
    return { input: 'worktree', mode: 'write', scope: allMode ? 'corpus' : 'pairs', anchors }
  }
  if (listMode) return { input: 'worktree', mode: 'list', scope: 'corpus', anchors: [] }
  return {
    input: cachedMode ? 'index' : 'worktree',
    mode: 'check',
    scope: anchors.length > 0 ? 'pairs' : 'corpus',
    anchors,
  }
}
