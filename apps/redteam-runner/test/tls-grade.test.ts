/**
 * The native TLS catalog check.
 *
 * The engine grades A/B/C/F from its own handshakes; this suite pins the mapping
 * from that letter to the catalog entry "Weak TLS Configuration (SSL Labs Grade:
 * C–F)" — including the band boundary, which is the whole point: B must not fire
 * and C must.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  WEAK_TLS_CATALOG_CHECK,
  weakTlsCatalogFinding,
  weakTlsSeverity } from '../src/net/tls-grade.js'

describe('weakTlsSeverity', () => {
  it('fires only inside the catalog C–F band', () => {
    assert.equal(weakTlsSeverity('C'), 'medium')
    assert.equal(weakTlsSeverity('F'), 'high')
  })

  it('leaves A and B alone', () => {
    assert.equal(weakTlsSeverity('A'), null)
    assert.equal(weakTlsSeverity('B'), null)
  })

  it('treats an unmeasured grade as no finding', () => {
    assert.equal(weakTlsSeverity(null), null)
    assert.equal(weakTlsSeverity(undefined), null)
    assert.equal(weakTlsSeverity(''), null)
  })

  it('normalizes case and surrounding space', () => {
    assert.equal(weakTlsSeverity(' f '), 'high')
    assert.equal(weakTlsSeverity('c'), 'medium')
  })

  it('ignores a letter the engine does not produce', () => {
    assert.equal(weakTlsSeverity('D'), null)
    assert.equal(weakTlsSeverity('E'), null)
    assert.equal(weakTlsSeverity('not-a-grade'), null)
  })
})

describe('weakTlsCatalogFinding', () => {
  it('names the catalog check exactly', () => {
    assert.equal(WEAK_TLS_CATALOG_CHECK, 'Weak TLS Configuration (SSL Labs Grade: C–F)')
  })

  it('produces the catalog entry for a legacy-protocol grade', () => {
    const f = weakTlsCatalogFinding('C', 'https://acme.example', 'T1190')
    assert.ok(f)
    assert.equal(f.title, WEAK_TLS_CATALOG_CHECK)
    assert.equal(f.severity, 'medium')
    assert.equal(f.attackId, 'T1190')
    assert.equal(f.vulnClass, 'transport-security')
    assert.match(f.evidence, /Native TLS grade C/)
    assert.match(f.evidence, /https:\/\/acme\.example/)
    assert.match(f.evidence, /TLS 1\.0/)
  })

  it('produces the catalog entry for a certificate-failure grade', () => {
    const f = weakTlsCatalogFinding('F', 'https://acme.example', 'T1190')
    assert.ok(f)
    assert.equal(f.severity, 'high')
    assert.match(f.evidence, /certificate fails validation/)
  })

  it('records that no external grading service was consulted', () => {
    const f = weakTlsCatalogFinding('C', 'https://acme.example', 'T1190')
    assert.match(f!.evidence, /no external grading service/)
  })

  it('adds nothing for a healthy or unmeasured target', () => {
    assert.equal(weakTlsCatalogFinding('A', 'https://acme.example', 'T1190'), null)
    assert.equal(weakTlsCatalogFinding('B', 'https://acme.example', 'T1190'), null)
    assert.equal(weakTlsCatalogFinding(null, 'https://acme.example', 'T1190'), null)
  })
})
