/** Repository and public-registry locations for the recorded npx dependency resolution. */

import { resolve } from 'node:path'

/** Repository root, resolved from this module's directory under `scripts/`. */
export const ROOT = resolve(import.meta.dirname, '..')

/** Published CLI whose production dependency tree the catalog records. */
export const PACKAGE = '@deepseek-ai/dsh'

/** npm tree location of the CLI inside the recorded consumer lockfile. */
export const ENTRY = `node_modules/${PACKAGE}`

/** Registry every recorded resolution must resolve from. */
export const REGISTRY = 'https://registry.npmjs.org/'

/** Recorded npm lockfile that a refresh replaces. */
export const LOCK = 'scripts/dependency-catalog/package-lock.json'

/** Capture metadata recorded beside the lockfile. */
export const METADATA = 'scripts/dependency-catalog/resolution.json'

/** Generated catalog checked against the recorded resolution. */
export const OUT = 'docs/dependency-catalog.json'
