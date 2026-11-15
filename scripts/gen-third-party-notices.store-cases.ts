/** Resolution of a package manifest inside the pnpm virtual store. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { virtualManifest } from './gen-third-party-notices.ts'

describe('virtualManifest', () => {
  it('resolves a manifest from an ordinary prefix-matching store directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-notices-prefix-'))
    try {
      const name = '@scope/pkg'
      const version = '1.0.0'
      const store = join(root, 'store')
      const manifestDir = join(store, `${name.replace('/', '+')}@${version}`, 'node_modules', name)
      mkdirSync(manifestDir, { recursive: true })
      writeFileSync(join(manifestDir, 'package.json'), JSON.stringify({ name, version, license: 'MIT' }))

      expect(virtualManifest(store, name)).toMatchObject({ name, version, license: 'MIT' })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('falls back to a content scan when pnpm 11 truncates the store directory name', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-notices-truncated-'))
    try {
      const name = '@scope/pkg'
      const version = '2.0.0'
      const store = join(root, 'store')
      // The truncated name no longer starts with `@scope+pkg@`, so only the
      // whole-store content scan can find the package.
      const manifestDir = join(store, '@scope+pkg_9f1c2d3e4a5b6c7d8e9f0a1b2c3d4e5f', 'node_modules', name)
      mkdirSync(manifestDir, { recursive: true })
      writeFileSync(join(manifestDir, 'package.json'), JSON.stringify({ name, version, license: 'Apache-2.0' }))

      expect(virtualManifest(store, name)).toMatchObject({ name, version, license: 'Apache-2.0' })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('selects the requested version when the store retains historical copies', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-notices-version-'))
    try {
      const name = '@scope/pkg'
      const store = join(root, 'store')
      for (const version of ['1.0.0', '2.0.0']) {
        const manifestDir = join(store, `${name.replace('/', '+')}@${version}`, 'node_modules', name)
        mkdirSync(manifestDir, { recursive: true })
        writeFileSync(join(manifestDir, 'package.json'), JSON.stringify({ name, version, license: 'MIT' }))
      }

      expect(virtualManifest(store, name, '2.0.0')).toMatchObject({ name, version: '2.0.0' })
      expect(virtualManifest(store, name, '3.0.0')).toBeUndefined()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('returns undefined when neither the prefix nor the content scan finds the package', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-notices-miss-'))
    try {
      const store = join(root, 'store')
      const other = join(store, 'other-pkg@1.0.0', 'node_modules', 'other-pkg')
      mkdirSync(other, { recursive: true })
      writeFileSync(join(other, 'package.json'), JSON.stringify({ name: 'other-pkg', version: '1.0.0' }))

      expect(virtualManifest(store, '@scope/missing')).toBeUndefined()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
