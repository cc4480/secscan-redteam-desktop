/** Reference-example README pair: the bilingual line alignment and the sidecar consistency record of the documented example. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const dir = 'packages/session/session-persistence-jsonl'

describe('reference-example README pair', () => {
  it('keeps exact English/Chinese physical line alignment', () => {
    const sourceLines = readFileSync(resolve(root, dir, 'README.md'), 'utf8').split('\n').length
    const zhLines = readFileSync(resolve(root, dir, 'README.zh.md'), 'utf8').split('\n').length
    expect(sourceLines).toBe(zhLines)
  })

  it('keeps the sidecar consistency record present', () => {
    const sidecar = readFileSync(resolve(root, dir, 'README.i18n.yaml'), 'utf8')
    expect(sidecar).toMatch(/^README\.md: [0-9a-f]{40}$/m)
    expect(sidecar).toMatch(/^README\.zh\.md: [0-9a-f]{40}$/m)
  })
})
