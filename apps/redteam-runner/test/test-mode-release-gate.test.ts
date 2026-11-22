/**
 * TEST MODE release gate — REDTEAM_TEST_MODE may lift ownership
 * verification only for a private/loopback engagement. A public target,
 * a public host in scope, or an empty scope runs the normal verification
 * path as if test mode were unset.
 */
import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { authorizePhase } from '../src/phases/authorize.js'
import type { Ctx } from '../src/context.js'

const dirs: string[] = []
const priorVerifiedDomainsFile = process.env['REDTEAM_VERIFIED_DOMAINS_FILE']

afterEach(() => {
  if (priorVerifiedDomainsFile === undefined) delete process.env['REDTEAM_VERIFIED_DOMAINS_FILE']
  else process.env['REDTEAM_VERIFIED_DOMAINS_FILE'] = priorVerifiedDomainsFile
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
})

/** Points the verified-domain store at a file holding `verified` (or an empty store). */
function seedStore(verified: string[]): void {
  const dir = mkdtempSync(join(tmpdir(), 'test-mode-release-gate-'))
  dirs.push(dir)
  const file = join(dir, 'verified-domains.json')
  const entries = Object.fromEntries(
    verified.map(d => [d, { token: 'fixture-token', verifiedAt: '2026-11-02T00:00:00.000Z', method: 'dns-txt' }]),
  )
  writeFileSync(file, JSON.stringify({ version: 1, pending: {}, verified: entries }))
  process.env['REDTEAM_VERIFIED_DOMAINS_FILE'] = file
}

function authorizeCtx(domain: string, hosts: string[]) {
  const appended: Array<{ action: string; result: string }> = []
  const ctx = {
    domain,
    hosts,
    input: {
      mode: 'red',
      objective: 'test-mode release gate proof',
      operatorName: 'Test Operator',
      roe: { scope: hosts, outOfScope: [] } },
    config: { testMode: true, localSandbox: false },
    deps: {},
    events: {
      append: (e: { action: string; result: string }) => appended.push(e),
      updateState: () => undefined } } as unknown as Ctx
  return { ctx, appended }
}

const testModeEvents = (a: Array<{ action: string }>) => a.filter(e => e.action === 'test_mode_active').length

describe('test mode release gate', () => {
  it('does not bypass ownership for a public target with no verification record', async () => {
    seedStore([])
    const { ctx, appended } = authorizeCtx('example.com', ['example.com'])
    const verdict = await authorizePhase(ctx)
    assert.equal(verdict.allowed, false)
    assert.equal(testModeEvents(appended), 0)
  })

  it('still bypasses for an all-loopback scope and logs test_mode_active', async () => {
    seedStore([])
    const { ctx, appended } = authorizeCtx('127.0.0.1', ['127.0.0.1'])
    const verdict = await authorizePhase(ctx)
    assert.equal(verdict.allowed, true)
    assert.equal(testModeEvents(appended), 1)
  })

  it('does not bypass for an empty scope', async () => {
    seedStore([])
    const { ctx, appended } = authorizeCtx('127.0.0.1', [])
    const verdict = await authorizePhase(ctx)
    assert.equal(verdict.allowed, false)
    assert.equal(testModeEvents(appended), 0)
  })

  it('does not bypass for a public domain with only a private host in scope', async () => {
    seedStore([])
    const { ctx, appended } = authorizeCtx('example.com', ['127.0.0.1'])
    const verdict = await authorizePhase(ctx)
    assert.equal(verdict.allowed, false)
    assert.equal(testModeEvents(appended), 0)
  })

  it('a verified public target is allowed through the normal path, without test_mode_active', async () => {
    seedStore(['example.com'])
    const { ctx, appended } = authorizeCtx('example.com', ['example.com'])
    const verdict = await authorizePhase(ctx)
    assert.equal(verdict.allowed, true)
    assert.equal(testModeEvents(appended), 0)
  })
})
