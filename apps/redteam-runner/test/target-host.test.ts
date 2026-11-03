/**
 * Target resolution — the value the scope gate, rate limiter and lockout all key on.
 *
 * The defect this pins shut: the resolver preferred `args.host`, but http_probe,
 * burst_probe, secscan_exec and seclayer_* act on `args.url`. A caller could pass
 * an in-scope `host` to satisfy the gate and an out-of-scope `url` for the handler
 * to fetch — the gate would check a host that was never contacted. Resolution now
 * keys on `url` first, i.e. on what the request will actually reach.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { toolTargetHost } from '../src/dispatch/target-host.js'
import type { ToolCallRequest } from '@secscan/redteam-llm-router'

function call(name: string, args: Record<string, unknown>): ToolCallRequest {
  return { id: 'c-1', name, arguments: args } as ToolCallRequest
}

describe('toolTargetHost — resolves the host that will actually be contacted', () => {
  it('keys on url when a shadowing host is also present', () => {
    // The bypass: in-scope host, out-of-scope url.
    const host = toolTargetHost(call('http_probe', {
      host: 'in-scope.example.com',
      url: 'https://out-of-scope.example.net/admin',
    }))
    assert.equal(host, 'out-of-scope.example.net')
    assert.notEqual(host, 'in-scope.example.com')
  })

  it('keys on url alone', () => {
    assert.equal(
      toolTargetHost(call('http_probe', { url: 'https://target.example.org/a?b=1' })),
      'target.example.org',
    )
  })

  it('still keys on host for tools that carry the target there', () => {
    // sqlmap/ffuf/gobuster/nikto take a full URL in `host`; hostname-keyed so a
    // varying path or scheme cannot mint a fresh bucket for the same host.
    assert.equal(
      toolTargetHost(call('sqlmap_exec', { action: 'run', host: 'https://shop.example.com/x?y=1' })),
      'shop.example.com',
    )
  })

  it('reports no target for a tool that performs no target traffic', () => {
    assert.equal(toolTargetHost(call('load_skill', { name: 'webapp-scan' })), undefined)
  })
})
