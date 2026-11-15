/** Synthetic workspace package fixtures shared by the plugin metadata spec cases. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach } from 'vitest'

/** Temporary workspace root, recreated empty before every case. */
export let root: string

/** Package directory the fixture writers below resolve their paths against. */
export let dir: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dsh-meta-gate-'))
  dir = join(root, 'packages', 'test', 'plugin')
  mkdirSync(dir, { recursive: true })
})
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

/** Point the fixture writers at another package inside the current workspace root. */
export function usePluginDirectory(path: string): void {
  dir = path
}

/** Write a file relative to the fixture package directory, creating parent directories. */
export function file(path: string, contents: string): void {
  mkdirSync(dirname(join(dir, path)), { recursive: true })
  writeFileSync(join(dir, path), contents)
}

/** Write a JSON document relative to the fixture package directory. */
export function json(path: string, contents: unknown): void {
  file(path, JSON.stringify(contents))
}

/** Write the fixture package manifest, overriding the fields a case supplies. */
export function manifest(fields: object = {}): void {
  json('package.json', {
    name: '@test/plugin',
    description: 'Package description',
    type: 'module',
    exports: { '.': './lib/index.js', './package.json': './package.json', './locale/*.json': './locale/*.json' },
    files: ['lib', 'locale'],
    ...fields,
  })
}
