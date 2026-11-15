/** The temporary checkout tree the default-product isolation cases run against. */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach } from 'vitest'

/** Fixture roots created by `fixture()`, removed after each case. */
const roots: string[] = []

export const experimental = '@deepseek-ai/dsh-experimental-prototype'
export const core = '@deepseek-ai/dsh-core'
export const base = '@deepseek-ai/dsh-base'
export const profile = 'packages/boot/app-boot/src/profile.ts'
export const preset = 'packages/bundle/web-app/presets/standard.patch.yml'
export const patch = 'packages/bundle/base/cordis.patch.yml'

/** Writes one file below `root`, JSON-encoding every non-string value. */
export function write(root: string, path: string, value: unknown): void {
  const target = join(root, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, typeof value === 'string' ? value : `${JSON.stringify(value)}\n`)
}

/** Merges `fields` into the manifest already written at `path`. */
export function manifest(root: string, path: string, fields: Record<string, unknown>): void {
  const existing = JSON.parse(readFileSync(join(root, path), 'utf8')) as Record<string, unknown>
  write(root, path, { ...existing, ...fields })
}

/** Creates a fixture checkout with the default-product inputs every case starts from. */
export function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh.default-isolation-'))
  roots.push(root)
  write(root, 'apps/cli/package.json', { name: '@deepseek-ai/dsh', dependencies: { [core]: 'workspace:^' } })
  write(root, 'apps/cli/src/bin.ts', 'export {}\n')
  write(root, 'apps/web/package.json', { name: '@deepseek-ai/dsh-web-frontend' })
  write(root, 'apps/web/index.html', '<script type="module" src="/src/main.ts"></script>')
  write(root, 'apps/web/src/main.ts', 'export {}\n')
  write(root, 'python/sdk-runtime/package.json', { name: '@deepseek-ai/dsh-python-runtime' })
  write(root, 'packages/core/core/package.json', { name: core })
  write(root, 'packages/core/core/src/index.ts', 'export {}\n')
  write(root, 'packages/bundle/base/package.json', { name: base, dsh: { bundle: { patch: './cordis.patch.yml' } } })
  write(root, patch, [{ insert: [{ name: core }] }])
  write(root, preset, [{ insert: [{ name: '@deepseek-ai/dsh-agent-preset', config: { id: 'standard', plugins: [{ name: core }] } }] }])
  write(root, 'packages/preset/agent-preset/package.json', { name: '@deepseek-ai/dsh-agent-preset' })
  write(root, profile, `export const PROFILE_TEMPLATES = { web: { bundles: ['${base}'] } }\n`
    + `export const DEFAULT_PROFILE_BUNDLES = ['${base}']\n`)
  write(root, 'packages/experimental/prototype/package.json', { name: experimental })
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
