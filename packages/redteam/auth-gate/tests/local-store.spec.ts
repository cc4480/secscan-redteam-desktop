/** coerceStore: validation and legacy-array migration of the verified-domain store. */

import { describe, expect, it } from 'vitest'
import { coerceStore } from '../src/local-store.ts'

describe('coerceStore legacy migration', () => {
  it('migrates a legacy verified array into dns-txt records', () => {
    const before = Date.now()
    const doc = coerceStore({ verified: ['Acme.Example', 'https://b.example/x', 42, ''], pending: {} })
    expect(Object.keys(doc.verified).sort()).toEqual(['acme.example', 'b.example'])
    const rec = doc.verified['acme.example']!
    expect(rec.token).toBe('(migrated)')
    expect(rec.method).toBe('dns-txt')
    expect(Date.parse(rec.verifiedAt)).toBeGreaterThanOrEqual(before - 1)
  })

  it('keeps well-formed record entries and drops malformed ones', () => {
    const doc = coerceStore({
      verified: { 'a.example': { token: 't', verifiedAt: '2026-01-01T00:00:00.000Z' }, 'b.example': { token: '' } },
      pending: { 'c.example': { token: 't', createdAt: '2026-01-01T00:00:00.000Z' }, 'd.example': {} },
    })
    expect(Object.keys(doc.verified)).toEqual(['a.example'])
    expect(Object.keys(doc.pending)).toEqual(['c.example'])
  })

  it('treats non-objects as an empty store', () => {
    expect(coerceStore(null).verified).toEqual({})
    expect(coerceStore('x').verified).toEqual({})
  })
})
