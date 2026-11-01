/**
 * net_exec — dispatch integration suite.
 *
 * Drives REAL dispatchTool calls through a fake ctx carrying the REAL
 * TargetRateLimiter / CredentialAttemptGuard (the lockout-dispatch
 * template), with a real NetExecutor bound via the
 * setNetExecutor test seam and loopback echo fixtures as the only targets.
 *
 * Pins the gate stack: the router's tier + central scope gates and the
 * handler's own ScopeGuard check run BEFORE the executor — the negative
 * control's out-of-scope call must leave the executor-invocation counters
 * and the fixture's connection count at exactly zero — plus the handler
 * gates behind them (handle↔peer binding, flood phase gate, production
 * confirmation) and the audit event every claimed invocation writes.
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:net'
import { dispatchTool } from '../src/dispatch/router.js'
import { setNetExecutor } from '../src/dispatch/net.js'
import { NetExecutor } from '../src/net/executor.js'
import { CredentialAttemptGuard } from '../src/safety/lockout.js'
import { TargetRateLimiter } from '../src/safety/ratelimit.js'
import type { Ctx } from '../src/context.js'
import type { ToolCallRequest } from '@secscan/redteam-llm-router'

interface FakeEvent {
  action: string
  result: string
  target?: string
}

let echoServer: Server
let echoPort = 0
let echoConnections = 0

before(async () => {
  echoServer = createServer((sock) => {
    echoConnections++
    sock.pipe(sock)
  })
  await new Promise<void>((resolve) => echoServer.listen(0, '127.0.0.1', resolve))
  echoPort = (echoServer.address() as { port: number }).port
})

after(async () => {
  echoServer.close()
})

function fakeCtx(opts: { scope: string[]; environment?: string; productionConfirmed?: boolean; tier?: number }) {
  const appended: FakeEvent[] = []
  const limiter = new TargetRateLimiter({ rpsPerHost: 1000, burst: 1000 }, () => 0)
  const ctx = {
    input: { mode: 'red', roe: { scope: opts.scope, outOfScope: [] }, fullBattery: false },
    hosts: opts.scope,
    events: {
      dir: '/tmp/net-dispatch-test-no-such-dir',
      engagementId: 'eng-net-test',
      append: (e: FakeEvent) => appended.push(e),
      updateState: () => {},
    },
    tier: { current: opts.tier ?? 2, declared: 2, chainSteps: new Map<string, number>() },
    safety: {
      limiter,
      lockout: new CredentialAttemptGuard(),
      rpsPerHost: 5,
      environment: opts.environment ?? 'staging',
      productionConfirmed: opts.productionConfirmed ?? false,
    },
    itemLedger: new Map(),
    opsecCooldown: new Set<string>(),
    coverage: new Set<string>(),
    targetCoverage: new Map(),
    probesUsed: 0,
    consecutive5xx: 0,
  } as unknown as Ctx
  return { ctx, appended }
}

/** A NetExecutor whose entry points count invocations (the zero-packet witness). */
function spiedExecutor() {
  const exec = new NetExecutor()
  const counts = { socketOpen: 0, socketSend: 0, sendPacket: 0, flood: 0 }
  const open = exec.socketOpen.bind(exec)
  exec.socketOpen = async (...a: Parameters<NetExecutor['socketOpen']>) => {
    counts.socketOpen++
    return open(...a)
  }
  const send = exec.socketSend.bind(exec)
  exec.socketSend = async (...a: Parameters<NetExecutor['socketSend']>) => {
    counts.socketSend++
    return send(...a)
  }
  const packet = exec.sendPacket.bind(exec)
  exec.sendPacket = async (...a: Parameters<NetExecutor['sendPacket']>) => {
    counts.sendPacket++
    return packet(...a)
  }
  const flood = exec.flood.bind(exec)
  exec.flood = async (...a: Parameters<NetExecutor['flood']>) => {
    counts.flood++
    return flood(...a)
  }
  return { exec, counts }
}

const call = (args: Record<string, unknown>): ToolCallRequest =>
  ({ name: 'net_exec', arguments: args }) as unknown as ToolCallRequest

const netEvents = (appended: FakeEvent[]) => appended.filter((e) => e.action === 'net_exec')

describe('net_exec dispatch — socket round-trip through the full gate stack', () => {
  it('open/send/recv/close succeed in scope, and every call writes its audit event', async () => {
    const { ctx, appended } = fakeCtx({ scope: ['127.0.0.1'] })
    const { exec, counts } = spiedExecutor()
    setNetExecutor(ctx, exec)
    const base = { attackId: 'T1046', category: 'validation' }

    const opened = await dispatchTool(ctx, 'exploiter', 'exploit',
      call({ ...base, action: 'socket_open', host: '127.0.0.1', port: echoPort, protocol: 'tcp' }))
    assert.match(opened.result, /open to 127\.0\.0\.1/, opened.result)
    const handleMatch = /handle (net-\d+)/.exec(opened.result)
    assert.ok(handleMatch, opened.result)
    const handle = handleMatch[1]!

    const payloadHex = Buffer.from('ping\x00\xff', 'latin1').toString('hex')
    const sent = await dispatchTool(ctx, 'exploiter', 'exploit',
      call({ ...base, action: 'socket_send', host: '127.0.0.1', handle, dataHex: payloadHex }))
    assert.match(sent.result, /sent 6 byte/, sent.result)

    const received = await dispatchTool(ctx, 'exploiter', 'exploit',
      call({ ...base, action: 'socket_recv', host: '127.0.0.1', handle, waitMs: 2000 }))
    assert.match(received.result, new RegExp(`hex: ${payloadHex}`), received.result)

    const closed = await dispatchTool(ctx, 'exploiter', 'exploit',
      call({ ...base, action: 'socket_close', host: '127.0.0.1', handle }))
    assert.match(closed.result, /closed/, closed.result)

    assert.deepEqual(counts, { socketOpen: 1, socketSend: 1, sendPacket: 0, flood: 0 })
    const audits = netEvents(appended)
    assert.equal(audits.length, 4, 'one audit event per claimed invocation')
    assert.ok(audits.every((e) => e.result.includes('params=')), 'audit events carry the params digest')
    assert.ok(audits.every((e) => !e.result.includes(payloadHex)), 'payloads are digested, never logged verbatim')
  })

  it('caps is targetless: it answers at tier 0 and audits against no target', async () => {
    const { ctx, appended } = fakeCtx({ scope: ['127.0.0.1'], tier: 0 })
    const opened = await dispatchTool(ctx, 'recon', 'recon',
      call({ action: 'caps', category: 'validation' }))
    assert.match(opened.result, /net_exec routes/, opened.result)
    assert.equal(netEvents(appended).length, 1)
    assert.equal(netEvents(appended)[0]!.target, '(no target)')
  })

  it('a target action at tier 1 is refused by the router tier gate before the executor', async () => {
    const { ctx } = fakeCtx({ scope: ['127.0.0.1'], tier: 1 })
    const { exec, counts } = spiedExecutor()
    setNetExecutor(ctx, exec)
    const r = await dispatchTool(ctx, 'exploiter', 'exploit',
      call({ action: 'socket_open', host: '127.0.0.1', port: echoPort, category: 'validation' }))
    assert.match(r.result, /[Tt]ier/, r.result)
    assert.equal(counts.socketOpen, 0)
  })
})

describe('net_exec dispatch — NEGATIVE CONTROL', () => {
  it('an out-of-scope target is denied and the fixture records zero packets', async () => {
    const { ctx, appended } = fakeCtx({ scope: ['127.0.0.1'] })
    const { exec, counts } = spiedExecutor()
    setNetExecutor(ctx, exec)
    const connectionsBefore = echoConnections

    const opened = await dispatchTool(ctx, 'exploiter', 'exploit',
      call({ action: 'socket_open', host: '10.255.255.1', port: echoPort, category: 'validation', attackId: 'T1046' }))
    assert.match(opened.result, /DENIED by scope/, opened.result)

    const packet = await dispatchTool(ctx, 'exploiter', 'exploit',
      call({
        action: 'packet_send', host: '10.255.255.1', packetProtocol: 'tcp', destPort: 80,
        category: 'validation', attackId: 'T1046',
      }))
    assert.match(packet.result, /DENIED by scope/, packet.result)

    const flood = await dispatchTool(ctx, 'exploiter', 'exploit',
      call({
        action: 'flood', host: '10.255.255.1', port: echoPort, floodMode: 'udp',
        ratePerSec: 10, durationMs: 100, category: 'validation', attackId: 'T1046',
      }))
    assert.match(flood.result, /DENIED by scope/, flood.result)

    assert.deepEqual(counts, { socketOpen: 0, socketSend: 0, sendPacket: 0, flood: 0 },
      'the executor never ran — zero packets by construction')
    assert.equal(echoConnections, connectionsBefore, 'the fixture saw no connection')
    assert.equal(exec.sessions.openCount, 0)
    // Denials are audited by the gate that fires: the router's central
    // scope gate appends a scope_violation event per denied call (the
    // handler's own net_exec audit covers calls that reach it).
    const denialAudits = appended.filter((e) => e.action === 'scope_violation' || e.action === 'net_exec')
    assert.ok(denialAudits.length >= 1, 'denials are audited too')
  })
})

describe('net_exec dispatch — handler gates behind scope', () => {
  it('a handle reaches only its own peer: a mismatched host is denied', async () => {
    const { ctx } = fakeCtx({ scope: ['127.0.0.1', 'example.com'] })
    const { exec, counts } = spiedExecutor()
    setNetExecutor(ctx, exec)
    const opened = await dispatchTool(ctx, 'exploiter', 'exploit',
      call({ action: 'socket_open', host: '127.0.0.1', port: echoPort, category: 'validation', attackId: 'T1046' }))
    const handle = /handle (net-\d+)/.exec(opened.result)?.[1]
    assert.ok(handle, opened.result)
    const r = await dispatchTool(ctx, 'exploiter', 'exploit',
      call({ action: 'socket_send', host: 'example.com', handle, dataHex: '00', category: 'validation', attackId: 'T1046' }))
    assert.match(r.result, /reaches only its own peer/, r.result)
    assert.equal(counts.socketSend, 0, 'the send never reached the executor')
    await dispatchTool(ctx, 'exploiter', 'exploit',
      call({ action: 'socket_close', host: '127.0.0.1', handle, category: 'validation', attackId: 'T1046' }))
  })

  it('flood is refused outside the exploit phase', async () => {
    const { ctx } = fakeCtx({ scope: ['127.0.0.1'] })
    const { exec, counts } = spiedExecutor()
    setNetExecutor(ctx, exec)
    const r = await dispatchTool(ctx, 'recon', 'recon',
      call({
        action: 'flood', host: '127.0.0.1', port: echoPort, floodMode: 'udp',
        ratePerSec: 10, durationMs: 100, category: 'validation', attackId: 'T1046',
      }))
    assert.match(r.result, /exploit phase only/, r.result)
    assert.equal(counts.flood, 0)
  })

  it('flood against production without the recorded confirmation is refused', async () => {
    const { ctx } = fakeCtx({ scope: ['127.0.0.1'], environment: 'production', productionConfirmed: false })
    const { exec, counts } = spiedExecutor()
    setNetExecutor(ctx, exec)
    const r = await dispatchTool(ctx, 'exploiter', 'exploit',
      call({
        action: 'flood', host: '127.0.0.1', port: echoPort, floodMode: 'udp',
        ratePerSec: 10, durationMs: 100, category: 'validation', attackId: 'T1046',
      }))
    assert.match(r.result, /production confirmation/, r.result)
    assert.equal(counts.flood, 0)
  })

  it('a short in-scope flood runs end-to-end in the exploit phase and is audited', async () => {
    const { ctx, appended } = fakeCtx({ scope: ['127.0.0.1'] })
    const { exec, counts } = spiedExecutor()
    setNetExecutor(ctx, exec)
    const r = await dispatchTool(ctx, 'exploiter', 'exploit',
      call({
        action: 'flood', host: '127.0.0.1', port: echoPort, floodMode: 'tcp-connect',
        ratePerSec: 50, durationMs: 300, concurrency: 4, category: 'validation', attackId: 'T1046',
      }))
    assert.match(r.result, /flood tcp-connect/, r.result)
    assert.equal(counts.flood, 1)
    assert.ok(netEvents(appended).some((e) => e.result.includes('flood')), 'the flood run is in the audit log')
  })
})
