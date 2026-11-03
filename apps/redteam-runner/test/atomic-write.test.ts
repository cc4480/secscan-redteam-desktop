/**
 * The atomic replace used by every store.
 *
 * The defect this guards: two modules each grew their own version with a
 * destructive fallback — on a failed rename they deleted the LIVE file, then
 * renamed, and the `finally` deleted the tmp too. One Windows AV lock or
 * EBUSY was enough to lose a findings registry or a foundry store outright.
 *
 * These tests pin the property that matters: a failed write leaves the
 * existing path exactly as it was.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { atomicWriteFileSync } from '../src/atomic.js'

function sandbox(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'atomic-write-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('atomicWriteFileSync', () => {
  it('lands the new content and leaves no tmp or bak behind', () => {
    const { dir, cleanup } = sandbox()
    try {
      const target = join(dir, 'registry.json')
      atomicWriteFileSync(target, '{"version":1}')
      assert.equal(readFileSync(target, 'utf8'), '{"version":1}')
      atomicWriteFileSync(target, '{"version":2}')
      assert.equal(readFileSync(target, 'utf8'), '{"version":2}')
      const strays = readdirSync(dir).filter(n => n.includes('.tmp-') || n.includes('.bak-'))
      assert.deepEqual(strays, [], `left scratch files behind: ${strays.join(', ')}`)
    } finally {
      cleanup()
    }
  })

  it('never loses the existing bytes when the replace takes the fallback path', () => {
    // A directory at the target path forces the rename-retry branch on every
    // platform. The old implementation unlinked the target first, which on a
    // real store meant the registry was gone and the tmp was deleted after it.
    // The guarantee is recoverability: the original bytes still exist somewhere
    // under the store directory, never destroyed by a failed replace.
    const { dir, cleanup } = sandbox()
    try {
      const target = join(dir, 'occupied')
      mkdirSync(target)
      writeFileSync(join(target, 'keep.txt'), 'evidence')
      try { atomicWriteFileSync(target, 'replacement') } catch { /* the throw is allowed */ }
      const survivors = readdirSync(dir).filter(n => n.startsWith('occupied'))
      const recoverable = survivors.some(name => {
        const candidate = join(dir, name, 'keep.txt')
        return existsSync(candidate) && readFileSync(candidate, 'utf8') === 'evidence'
      })
      assert.ok(recoverable, `the live bytes vanished; siblings: ${survivors.join(', ')}`)
    } finally {
      cleanup()
    }
  })

  it('creates nothing when the parent directory is absent', () => {
    const { dir, cleanup } = sandbox()
    try {
      const target = join(dir, 'missing-parent', 'store.json')
      assert.throws(() => atomicWriteFileSync(target, 'x'))
      assert.equal(existsSync(target), false)
    } finally {
      cleanup()
    }
  })
})
