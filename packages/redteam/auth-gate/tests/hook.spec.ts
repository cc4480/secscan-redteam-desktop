/**
 * Auth-gate decision table.
 *
 * The scan half is the half this hook enforces, so it is pinned here in both
 * directions: an active request without local proof is denied, and an active
 * request WITH proof is allowed. The host half is pinned as a pass-through on
 * purpose — the engagement engine owns host scope, and a test that recorded a
 * scope decision here would be recording a check that does not exist and must
 * not (see ../src/hook.ts's module doc comment).
 */

import { describe, expect, it, vi } from 'vitest'
import { decide, isHostFamilyProbe, isScanTool, targetDomain, wantsActiveTesting } from '../src/hook.ts'
import type { GateContext } from '../src/hook.ts'

/** A gate whose local verdict is fixed, and which counts its own calls. */
function gate(verified: boolean): GateContext & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    isVerified: async (domain: string) => {
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
  it('allows a passive scan without asking the verifier', async () => {
    const ctx = gate(false)
    await expect(decide({ toolName: 'mcp__secscan__scan_url', arguments: { url: 'https://acme.example' } }, ctx))
      .resolves.toEqual({ kind: 'allow' })
    expect(ctx.calls).toEqual([])
  })

  it('denies an active scan whose domain is not locally verified', async () => {
    const ctx = gate(false)
    const decision = await decide(
      { toolName: 'mcp__secscan__scan_url', arguments: { url: 'https://acme.example', aggressive: true } },
      ctx,
    )
    expect(decision.kind).toBe('deny')
    expect(decision.kind === 'deny' ? decision.reason : '').toContain('ACTIVE TESTING DENIED for acme.example')
    expect(ctx.calls).toEqual(['acme.example'])
  })

  it('allows an active scan only on the locally verified list', async () => {
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

  it('fails closed when the verification check throws', async () => {
    const ctx: GateContext = { isVerified: () => Promise.reject(new Error('network down')) }
    const decision = await decide(
      { toolName: 'scan_url', arguments: { url: 'https://acme.example', active: true } },
      ctx,
    )
    expect(decision.kind).toBe('deny')
  })

  it('passes host-family probes through to the engagement engine', async () => {
    const ctx = gate(false)
    const verify = vi.spyOn(ctx, 'isVerified')
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
    expect(isScanTool('secscan_exec')).toBe(true)
    expect(isScanTool('mcp__secscan__secscan_exec')).toBe(true)
    expect(isScanTool('mcp__secscan__get_report')).toBe(false)
  })
})

describe('decide on secscan_exec', () => {
  const call = (args: Record<string, unknown>) => ({ toolName: 'secscan_exec', arguments: args })

  it('denies depth=deep on an unverified domain', async () => {
    const decision = await decide(call({ url: 'https://acme.example', depth: 'deep' }), gate(false))
    expect(decision.kind).toBe('deny')
  })

  it('allows depth=deep on a verified domain', async () => {
    const ctx = gate(true)
    await expect(decide(call({ url: 'https://acme.example', depth: 'deep' }), ctx)).resolves.toEqual({ kind: 'allow' })
    expect(ctx.calls).toEqual(['acme.example'])
  })

  it('allows depth=passive and a missing depth without asking the verifier', async () => {
    const ctx = gate(false)
    await expect(decide(call({ url: 'https://acme.example', depth: 'passive' }), ctx)).resolves.toEqual({ kind: 'allow' })
    await expect(decide(call({ url: 'https://acme.example' }), ctx)).resolves.toEqual({ kind: 'allow' })
    expect(ctx.calls).toEqual([])
  })

  it('denies depth=deep with a missing or unparseable url', async () => {
    const ctx = gate(true)
    expect((await decide(call({ depth: 'deep' }), ctx)).kind).toBe('deny')
    expect((await decide(call({ url: 'not a url', depth: 'deep' }), ctx)).kind).toBe('deny')
    expect(ctx.calls).toEqual([])
  })

  it('does not let a passive flag or another url key redirect the active check', async () => {
    const ctx = gate(false)
    expect((await decide(call({ url: 'https://acme.example', depth: 'deep', passive: true }), ctx)).kind).toBe('deny')
    expect(ctx.calls).toEqual(['acme.example'])
    const ctx2 = gate(true)
    expect((await decide(call({ url: 'not a url', target: 'https://other.example', depth: 'deep' }), ctx2)).kind).toBe('deny')
    expect(ctx2.calls).toEqual([])
  })

  it('leaves the host-family pass-through unchanged', async () => {
    const ctx = gate(false)
    await expect(
      decide({ toolName: 'mcp__redteam__nmap_exec', arguments: { targetProfile: 'secscan', depth: 'deep', url: 'https://acme.example' } }, ctx),
    ).resolves.toEqual({ kind: 'allow' })
    expect(ctx.calls).toEqual([])
  })

  it('still gates secscan_exec when it arrives under the engine namespace with a targetProfile', async () => {
    const ctx = gate(false)
    const decision = await decide(
      { toolName: 'mcp__redteam__secscan_exec', arguments: { targetProfile: 'secscan', depth: 'deep', url: 'https://acme.example' } },
      ctx,
    )
    expect(decision.kind).toBe('deny')
  })
})
