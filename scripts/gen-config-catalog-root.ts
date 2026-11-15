import { resolve } from 'node:path'

/** Absolute repository root, resolved from this module's directory. */
export const root = resolve(import.meta.dirname, '..')

/** Repo-relative path of the generated config catalog. */
export const OUT = 'docs/config-catalog.md'
