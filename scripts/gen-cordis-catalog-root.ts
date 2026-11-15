import { resolve } from 'node:path'

/** Absolute repository root, resolved from this module's directory. */
export const root = resolve(import.meta.dirname, '..')

/** Repo-relative directory holding the paired subsystems pages. */
export const SUBSYSTEMS_DIR = 'docs/subsystems'

/** Repo-relative path of the generated inherited-tier page. */
export const OUT_INHERITED = 'docs/cordis-api/inherited.md'

/** Repo-relative path of the generated model-facing runtime API module. */
export const OUT_RUNTIME_API = 'packages/extensions/tool-cordis/src/api-catalog.ts'
