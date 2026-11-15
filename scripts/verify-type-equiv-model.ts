/**
 * Records shared by the verify-type-equiv gate modules: the repository root,
 * one manifest entry, and one extracted source-equivalence block.
 */

import { resolve } from 'node:path'

/** Repository root: the directory holding `scripts/`. */
export const repoRoot = resolve(import.meta.dirname, '..')

/** One manifest entry: a source-equivalence block and its source symbol. */
export interface ManifestEntry {
  /** Doc file (repo-relative) containing the source-equivalence block. */
  doc: string
  /** The declared symbol the block must match (e.g. `SessionEvent`). */
  symbol: string
  /** Source file (repo-relative) that exports the symbol. */
  source: string
  /** Explicit module augmentations whose members complete an interface. */
  augmentations?: Array<{
    /** Source file (repo-relative) containing the augmentation. */
    source: string
    /** String-literal module specifier containing the merged interface. */
    module: string
  }>
  /** Complete declaration (default), or a body-stripped public class API. */
  projection?: 'public-api'
}

/** One extracted ` ```ts type-equiv ` or ` ```ts public-api ` block. */
export interface EquivBlock {
  doc: string
  /** 1-based line of the opening fence (for diagnostics). */
  line: number
  /** Symbol name parsed from the block's declaration. */
  symbol: string
  /** Complete declaration (default), or a body-stripped public class API. */
  projection?: 'public-api'
  /** Block body (the pasted declaration). */
  code: string
}
