/**
 * Auth-gate decision table.
 *
 * The scan half is the half this hook enforces, so it is pinned here in both
 * directions: an active request without server proof is denied, and an active
 * request WITH proof is allowed. The host half is pinned as a pass-through on
 * purpose — the engagement engine owns host scope, and a test that recorded a
 * scope decision here would be recording a check that does not exist and must
 * not (see ../src/hook.ts's module doc comment).
 */

import { describe, expect, it, vi } from 'vitest'
import { decide, isHostFamilyProbe, isScanTool, targetDomain, wantsActiveTesting } from '../src/hook.ts'
import type { GateContext } from '../src/hook.ts'

/** A gate whose server verdict is fixed, and which counts its own calls. */
function gate(verified: boolean): GateContext & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    isServerVerified: async (domain: string) => {
      calls.push(domain)
      return verified
    },
  }
}

describe('targetDomain', () => {
  it('reads the first parseable URL under the known argument keys', () => {
    expect(targetDomain({ url: 'https://Acme.example/path' })).toBe('acme.example')
    expect(targetDomain({ target_url: 'https://shop.example' })).toBe('shop.example')
    expect(targetDomain({ url: 'not a url', site: 'https://second.example' })).toBe('second.example')
    expect(targetDomain({ url: 42, target: null })).toBeNull()
  })
})

describe('wantsActiveTesting', () => {
  it('detects an explicit active request by key or by value', () => {
    expect(wantsActiveTesting({ aggressive: true })).toBe(true)
    expect(wantsActiveTesting({ mode: 'intrusive' })).toBe(true)
    expect(wantsActiveTesting({ tier: 'ACTIVE SCAN' })).toBe(true)
    expect(wantsActiveTesting({ aggressive: false })).toBe(false)
    expect(wantsActiveTesting({ url: 'https://acme.example' })).toBe(false)
  })
})

describe('decide', () => {
  it('allows a passive scan without asking the server', async () => {
    const ctx = gate(false)
    await expect(decide({ toolName: 'mcp__secscan__scan_url', arguments: { url: 'https://acme.example' } }, ctx))
      .resolves.toEqual({ kind: 'allow' })
    expect(ctx.calls).toEqual([])
  })

  it('denies an active scan whose domain is not server-verified', async () => {
    const ctx = gate(false)
    const decision = await decide(
      { toolName: 'mcp__secscan__scan_url', arguments: { url: 'https://acme.example', aggressive: true } },
      ctx,
    )
    expect(decision.kind).toBe('deny')
    expect(decision.kind === 'deny' ? decision.reason : '').toContain('ACTIVE TESTING DENIED for acme.example')
    expect(ctx.calls).toEqual(['acme.example'])
  })

  it('allows an active scan only on the server-verified list', async () => {
    const ctx = gate(true)
    await expect(decide(
      { toolName: 'mcp__secscan__scan_url', arguments: { url: 'https://acme.example', aggressive: true } },
      ctx,
    )).resolves.toEqual({ kind: 'allow' })
  })

  it('denies an active scan with no parseable target', async () => {
    const ctx = gate(true)
    await expect(decide({ toolName: 'scan_url', arguments: { aggressive: true } }, ctx))
      .resolves.toEqual({ kind: 'deny', reason: '[auth-gate] denied: no parseable target URL in the scan arguments.' })
    expect(ctx.calls).toEqual([])
  })

  it('fails closed when the server check throws', async () => {
    const ctx: GateContext = { isServerVerified: () => Promise.reject(new Error('network down')) }
    const decision = await decide(
      { toolName: 'scan_url', arguments: { url: 'https://acme.example', active: true } },
      ctx,
    )
    expect(decision.kind).toBe('deny')
  })

  it('passes host-family probes through to the engagement engine', async () => {
    const ctx = gate(false)
    const verify = vi.spyOn(ctx, 'isServerVerified')
    // Every mcp__redteam__* executor tool carries a required targetProfile, and
    // the engine checks the host against the engagement's scope and its tier.
    // This hook adds nothing to that and must not pretend to.
    await expect(decide(
      {
        toolName: 'mcp__redteam__ssh_exec',
        arguments: { host: '10.0.0.5', targetProfile: 'linux', engagementId: 'eng-1' },
      },
      ctx,
    )).resolves.toEqual({ kind: 'allow' })
    expect(verify).not.toHaveBeenCalled()
  })
})

describe('isHostFamilyProbe', () => {
  it('recognizes every engine target family under the redteam namespace', () => {
    for (const targetProfile of ['secscan', 'seclayer', 'windows', 'linux']) {
      expect(isHostFamilyProbe('mcp__redteam__nmap_exec', { targetProfile })).toBe(true)
    }
  })

  it('excludes other namespaces, other engines, and non-probe engine tools', () => {
    expect(isHostFamilyProbe('mcp__redteam__nmap_exec', { targetProfile: 'windows' })).toBe(true)
    expect(isHostFamilyProbe('mcp__secscan__scan_url', { targetProfile: 'windows' })).toBe(false)
    expect(isHostFamilyProbe('mcp__redteam__get_findings', { engagementId: 'eng-1' })).toBe(false)
    expect(isHostFamilyProbe('nmap_exec', { targetProfile: 'windows' })).toBe(false)
    expect(isHostFamilyProbe('mcp__redteam__nmap_exec', { targetProfile: 7 })).toBe(false)
  })
})

describe('isScanTool', () => {
  it('matches the scan tool in and out of the harness MCP namespace', () => {
    expect(isScanTool('scan_url')).toBe(true)
    expect(isScanTool('mcp__secscan__scan_url')).toBe(true)
    expect(isScanTool('mcp__secscan__get_report')).toBe(false)
  })
})
