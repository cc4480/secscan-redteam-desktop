/**
 * WIRING acceptance for the agent-layer auth gate.
 *
 * installAuthGate registers a `tools/pre-execute` listener. These cases capture
 * that listener from a stub Context and invoke it with a `secscan_exec` deep
 * event, reading the verified-domain store selected by
 * REDTEAM_VERIFIED_DOMAINS_FILE. This is wiring acceptance only: no harness
 * path sends `secscan_exec` through `tools/pre-execute` today, so it does not
 * prove the gate on a production call path.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SERVER_TOKEN_PREFIX, writeFileAtomic, type StoreDoc } from '@secscan/redteam-auth-gate'
import { installAuthGate } from '../src/auth-gate.ts'

interface Decision {
  kind: string
  reason?: string
}

type PreExecuteListener = (
  exec: { name: string; arguments: unknown },
  next: () => Promise<Decision>,
) => Promise<Decision>

let dir = ''
let storeFile = ''
let savedStore: string | undefined

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'auth-gate-wiring-'))
  storeFile = join(dir, 'verified-domains.json')
  savedStore = process.env['REDTEAM_VERIFIED_DOMAINS_FILE']
  process.env['REDTEAM_VERIFIED_DOMAINS_FILE'] = storeFile
})

afterEach(() => {
  if (savedStore === undefined) delete process.env['REDTEAM_VERIFIED_DOMAINS_FILE']
  else process.env['REDTEAM_VERIFIED_DOMAINS_FILE'] = savedStore
  rmSync(dir, { recursive: true, force: true })
})

/** Install the gate on a stub Context and return the listeners it registered, by event name. */
function installAndCapture(): Map<string, PreExecuteListener> {
  const listeners = new Map<string, PreExecuteListener>()
  const ctx = {
    on: (event: string, listener: PreExecuteListener) => {
      listeners.set(event, listener)
      return () => {}
    },
  }
  installAuthGate(ctx as never)
  return listeners
}

/** Invoke the captured pre-execute listener with a deep secscan_exec call against `url`. */
async function deepScan(url: string): Promise<{ decision: Decision; delegated: boolean }> {
  const listener = installAndCapture().get('tools/pre-execute')
  expect(listener).toBeDefined()
  let delegated = false
  const decision = await listener!({ name: 'secscan_exec', arguments: { url, depth: 'deep' } }, async () => {
    delegated = true
    return { kind: 'allow' }
  })
  return { decision, delegated }
}

describe('auth gate WIRING acceptance (installAuthGate -> tools/pre-execute)', () => {
  it('registers exactly one listener, on tools/pre-execute', () => {
    expect([...installAndCapture().keys()]).toEqual(['tools/pre-execute'])
  })

  it('denies a deep secscan_exec against an unverified domain without delegating', async () => {
    const { decision, delegated } = await deepScan('https://acme.example')
    expect(decision.kind).toBe('deny')
    expect(decision.reason).toContain('acme.example')
    expect(delegated).toBe(false)
  })

  it('allows a deep secscan_exec against a domain verified in the seeded store, by delegating to next()', async () => {
    const doc: StoreDoc = {
      version: 1,
      pending: {},
      verified: {
        'acme.example': { token: `${SERVER_TOKEN_PREFIX}wiring`, verifiedAt: new Date().toISOString(), method: 'dns-txt' },
      },
    }
    await writeFileAtomic(storeFile, `${JSON.stringify(doc, null, 2)}\n`)
    const { decision, delegated } = await deepScan('https://acme.example')
    expect(decision).toEqual({ kind: 'allow' })
    expect(delegated).toBe(true)
  })
})
