/**
 * Repository roots and projection inputs for the documentation projection,
 * shared by the sibling projection modules.
 */

import { resolve } from 'node:path'
import { docsPages, type DocsPage } from '../website/docs.ts'

/** Absolute path of the repository root, derived from this module's directory. */
export const root = resolve(import.meta.dirname, '..')

/** Generated VitePress source tree, replaced wholesale by each projection pass. */
export const generatedRoot = resolve(root, 'website/.generated')

/**
 * Resolve the public repository ref used by projected source links.
 *
 * @param environment Build environment containing an optional explicit public ref.
 * @returns The configured public ref, or `master`.
 */
export function resolveRepositoryRef(environment: NodeJS.ProcessEnv): string {
  return environment.DOCS_REPOSITORY_REF ?? 'master'
}

/** Manifest and repository inputs for one projection pass. */
export interface ProjectionContext {
  /** Pages to project. */
  pages: DocsPage[]
  /** Repository root every source and placed image must live under. */
  repoRoot: string
  /** Public ref used by projected GitHub links. */
  repositoryRef: string
}

/**
 * Projection inputs for this repository's publication manifest.
 * @returns The manifest pages, this checkout's root, and the configured public ref.
 */
export function defaultProjectionContext(): ProjectionContext {
  return { pages: docsPages, repoRoot: root, repositoryRef: resolveRepositoryRef(process.env) }
}
