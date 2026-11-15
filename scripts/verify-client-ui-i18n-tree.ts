/**
 * Client source discovery: which files the check reads.
 */

import { globSync } from 'node:fs'
import { resolve } from 'node:path'

/** Repository root above this script's directory. */
export const clientUiRoot = resolve(import.meta.dirname, '..')

/**
 * Resolve the normalized Client source root containing one TSX component.
 * @param file - Glob result using native or POSIX separators.
 * @returns Repository-relative `src/client` root, or undefined outside that tree.
 */
export function clientSourceRoot(file: string): string | undefined {
  const normalized = file.replaceAll('\\', '/')
  const marker = '/src/client/'
  const index = normalized.indexOf(marker)
  return index < 0 ? undefined : normalized.slice(0, index + marker.length - 1)
}

/**
 * Every Client UI source the check owns.
 * @returns Repository-relative POSIX paths, sorted and deduplicated.
 */
export function sourceFiles(): string[] {
  const clientComponentRoots = new Set(
    globSync('packages/*/*/src/client/**/*.tsx', { cwd: clientUiRoot })
      .map(clientSourceRoot)
      .filter((clientRoot): clientRoot is string => clientRoot !== undefined),
  )
  return [...new Set([
    ...globSync('packages/client/*/src/**/*.tsx', { cwd: clientUiRoot }),
    ...globSync('packages/client/ui-*/src/**/*.{ts,tsx}', { cwd: clientUiRoot }),
    ...[...clientComponentRoots].flatMap(clientRoot =>
      globSync(`${clientRoot}/**/*.{ts,tsx}`, { cwd: clientUiRoot })),
    ...globSync('apps/web/src/**/*.{ts,tsx}', { cwd: clientUiRoot }),
    ...globSync('apps/desktop/src/{main,update-coordinator}.{ts,tsx}', { cwd: clientUiRoot }),
    ...globSync('apps/desktop/renderer/*.js', { cwd: clientUiRoot }),
  ])]
    .map(file => file.replaceAll('\\', '/'))
    .filter(file => !file.endsWith('.d.ts'))
    .sort()
}
