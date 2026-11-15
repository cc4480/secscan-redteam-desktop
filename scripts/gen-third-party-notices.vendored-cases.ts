/** Parsing of the committed vendor manifest table. */

import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { type Manifest, parseVendoredRows } from './gen-third-party-notices.ts'

const root = resolve(import.meta.dirname, '..')

describe('parseVendoredRows', () => {
  it('reads the committed vendor manifest table', () => {
    const rows = parseVendoredRows(readFileSync(resolve(root, 'vendor/README.md'), 'utf8'))

    expect(rows.length).toBeGreaterThan(0)
    expect(rows).toContainEqual({
      npmName: '@deepseek-ai/cordis',
      upstreamName: 'cordis',
      upstream: 'https://github.com/cordiverse/cordis',
    })
    // The upstream column carries a trailing package path for some rows; it is not part of the URL.
    expect(rows.every(row => /^https:\/\/\S+$/.test(row.upstream))).toBe(true)
  })

  it('yields nothing when the table columns change, so the generator fails loud', () => {
    expect(parseVendoredRows('| `cordis/` | `@deepseek-ai/cordis` | cordis | 4.0.0 | https://example.com | `abc123` |\n')).toEqual([])
  })

  it('covers every vendored directory, so no package can drop out of the notices', () => {
    const parsed = new Set(parseVendoredRows(readFileSync(resolve(root, 'vendor/README.md'), 'utf8')).map(row => row.npmName))
    const onDisk = readdirSync(resolve(root, 'vendor'), { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => (JSON.parse(readFileSync(resolve(root, 'vendor', entry.name, 'package.json'), 'utf8')) as Manifest).name)

    expect([...onDisk].sort()).toEqual([...parsed].sort())
  })
})
