/**
 * Foundry store tests: registry persistence round-trip and idempotency.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  appendSanitizerNote,
  caseContentHash,
  caseIdFor,
  listCases,
  loadRegistry,
  readSanitizerNotes,
  registerCase,
  type FoundryCase,
} from '../src/foundry/store.js'
import { classifyFinding } from '../src/foundry/classify.js'

function tmpStore(): string {
  return join(mkdtempSync(join(tmpdir(), 'foundry-store-')), 'foundry-store')
}

function sampleCase(engagementId: string): FoundryCase {
  const pattern = {
    family: 'sqli',
    vulnClass: 'sql-injection',
    cwe: 'CWE-89',
    severity: 'high',
    endpointShape: ['/search?q={}'],
    methodMix: [],
    payloadClass: 'tautology-quote',
    proofType: 'cell-proven',
    techFingerprints: ['wordpress'],
  }
  const contentHash = caseContentHash(pattern)
  return {
    id: caseIdFor(engagementId, contentHash),
    kind: 'live-case',
    origin: 'scan',
    family: 'sqli',
    vulnClass: pattern.vulnClass,
    cwe: pattern.cwe,
    severity: pattern.severity,
    endpointShape: pattern.endpointShape,
    methodMix: pattern.methodMix,
    payloadClass: pattern.payloadClass,
    proofType: pattern.proofType,
    mechanisms: ['live-detection', 'dual-exploiter-cell', 'state-confirmation'],
    techFingerprints: pattern.techFingerprints,
    tier: 'SILVER',
    sourceEngagementId: engagementId,
    lineage: null,
    createdAt: '2026-10-25T00:00:00.000Z',
    contentHash,
  }
}

describe('foundry store', () => {
  it('persists a case to the registry and its bundle file, and reads it back', () => {
    const store = tmpStore()
    const foundryCase = sampleCase('eng-1')
    assert.equal(registerCase(store, foundryCase), true)
    const registry = loadRegistry(store)
    assert.equal(registry.entries.length, 1)
    assert.equal(registry.entries[0]?.id, foundryCase.id)
    assert.equal(registry.entries[0]?.tier, 'SILVER')
    const bundlePath = join(store, 'bundles', foundryCase.id, 'case.json')
    assert.equal(existsSync(bundlePath), true)
    const onDisk = JSON.parse(readFileSync(bundlePath, 'utf8')) as FoundryCase
    assert.equal(onDisk.contentHash, foundryCase.contentHash)
    const listed = listCases(store)
    assert.equal(listed.length, 1)
    assert.equal(listed[0]?.family, 'sqli')
  })

  it('is idempotent: re-registering the same engagement + content adds nothing', () => {
    const store = tmpStore()
    const foundryCase = sampleCase('eng-1')
    assert.equal(registerCase(store, foundryCase), true)
    assert.equal(registerCase(store, foundryCase), false)
    // Same (engagement, content) under a forged different id is still a dupe.
    assert.equal(registerCase(store, { ...foundryCase, id: 'case-forged' }), false)
    assert.equal(loadRegistry(store).entries.length, 1)
    // A different engagement with the same content is a new case.
    assert.equal(registerCase(store, sampleCase('eng-2')), true)
    assert.equal(loadRegistry(store).entries.length, 2)
  })

  it('records sanitizer notes as counts/reasons only', () => {
    const store = tmpStore()
    appendSanitizerNote(store, { engagementId: 'eng-9', reasons: ['dlp:email'], at: '2026-10-25T00:00:00.000Z' })
    const notes = readSanitizerNotes(store, 10)
    assert.equal(notes.length, 1)
    assert.deepEqual(notes[0]?.reasons, ['dlp:email'])
  })

  it('reads an absent registry as empty', () => {
    const store = tmpStore()
    assert.deepEqual(loadRegistry(store), { version: 1, entries: [] })
    assert.deepEqual(listCases(store), [])
  })
})

describe('finding classification', () => {
  it('classifies by CWE, then vuln class, then title', () => {
    assert.equal(classifyFinding({ title: 'Issue (CWE-918) in fetcher' }).family, 'ssrf')
    assert.equal(classifyFinding({ vulnClass: 'sql-injection', title: 'x' }).family, 'sqli')
    assert.equal(classifyFinding({ title: 'Reflected XSS in search' }).family, 'xss')
    assert.equal(classifyFinding({ title: 'Path traversal in download' }).family, 'traversal')
  })

  it('never forces a fit: unmatched findings are unclassified', () => {
    const result = classifyFinding({ title: 'Verbose server banner' })
    assert.equal(result.family, 'unclassified')
    assert.equal(result.via, 'none')
  })
})
