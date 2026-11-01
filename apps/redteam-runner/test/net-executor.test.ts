/**
 * net_exec — executor suite against loopback fixtures only.
 *
 * Socket proofs run against local echo fixtures (TCP + UDP). The packet
 * sender is proven with an injected fake spawn replaying nping's output
 * format (argv construction + reply parsing + the kill-switch path); the
 * privileged live send is a Cho-zen/Range item — this VM has no nping.
 * Flood proofs run against a counting loopback server: the slot-clock
 * pacer must never let the sustained rate past the cap, the run must stop
 * at the duration cap on its own, and an abort must halt it mid-run.
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:net'
import { createSocket as createUdpSocket, type Socket as UdpSocket } from 'node:dgram'
import { NetExecutor } from '../src/net/executor.js'
import { resolveFloodParams, type PacketSpec } from '../src/net/policy.js'
import type { SpawnFn } from '../src/nmap/runner.js'

let tcpServer: Server
let tcpPort = 0
let tcpConnections = 0
let udpServer: UdpSocket
let udpPort = 0

before(async () => {
  tcpServer = createServer((sock) => {
    tcpConnections++
    sock.pipe(sock)
  })
  await new Promise<void>((resolve) => tcpServer.listen(0, '127.0.0.1', resolve))
  tcpPort = (tcpServer.address() as { port: number }).port
  udpServer = createUdpSocket('udp4')
  udpServer.on('message', (msg, rinfo) => {
    udpServer.send(msg, rinfo.port, rinfo.address)
  })
  await new Promise<void>((resolve) => udpServer.bind(0, '127.0.0.1', resolve))
  udpPort = udpServer.address().port
})

after(async () => {
  tcpServer.close()
  udpServer.close()
})

const SYN_SPEC: PacketSpec = {
  protocol: 'tcp', destIp: '10.0.0.2', sourceIp: '10.0.0.1', sourcePort: 12345, destPort: 80,
  tcpFlags: ['syn'], seq: 1, window: 8192, ttl: 64, identification: 0x1234, count: 2,
}
const SYN_PACKET_HEX =
  '45000028123440004006149a0a0000010a000002303900500000000100000000500220004b560000'

describe('socket shell — loopback round-trips', () => {
  it('TCP: open holds a handle, send/recv round-trips the exact bytes, close releases it', async () => {
    const exec = new NetExecutor()
    const opened = await exec.socketOpen({ protocol: 'tcp', host: '127.0.0.1', port: tcpPort })
    assert.ok(opened.ok, opened.message)
    const handle = opened.handle!
    assert.match(handle, /^net-\d+$/)
    assert.deepEqual(exec.sessions.peerOf(handle), { host: '127.0.0.1', port: tcpPort, protocol: 'tcp' })

    const payload = Buffer.from([0x00, 0x01, 0xfe, 0xff, 0x41, 0x42])
    const sent = await exec.socketSend(handle, payload)
    assert.ok(sent.ok)
    assert.equal(sent.sent, payload.length)
    const received = await exec.socketRecv(handle, 1024, 2000)
    assert.ok(received.ok)
    assert.deepEqual(received.data, payload)

    const closed = exec.socketClose(handle)
    assert.ok(closed.ok)
    assert.equal(exec.sessions.peerOf(handle), undefined)
    assert.equal(exec.sessions.openCount, 0)
    const after = await exec.socketRecv(handle, 16, 10)
    assert.equal(after.ok, false)
  })

  it('UDP: send/recv round-trips a datagram against the echo fixture', async (t) => {
    const exec = new NetExecutor()
    const opened = await exec.socketOpen({ protocol: 'udp', host: '127.0.0.1', port: udpPort })
    assert.ok(opened.ok, opened.message)
    const handle = opened.handle!
    try {
      const payload = Buffer.from('raw-bytes\x00\x01', 'latin1')
      const sent = await exec.socketSend(handle, payload)
      if (!sent.ok && /EPERM/.test(sent.message)) {
        // This VM's sandbox denies UDP sends outright (proven with a raw
        // node:dgram script carrying none of this code: send EPERM on
        // loopback). The round-trip proof belongs to an environment where
        // UDP is permitted — Cho-zen/Range. Skip, never fake a pass.
        t.skip('UDP blocked by this sandbox (EPERM on loopback send) — round-trip is a Cho-zen/Range proof item')
        return
      }
      assert.ok(sent.ok, sent.message)
      const received = await exec.socketRecv(handle, 1024, 2000)
      assert.ok(received.ok)
      assert.deepEqual(received.data, payload)
    } finally {
      exec.socketClose(handle)
    }
  })

  it('recv on an idle session returns empty (a result, not an error) after the wait window', async () => {
    const exec = new NetExecutor()
    const opened = await exec.socketOpen({ protocol: 'tcp', host: '127.0.0.1', port: tcpPort })
    assert.ok(opened.ok)
    const received = await exec.socketRecv(opened.handle!, 100, 60)
    assert.ok(received.ok)
    assert.equal(received.data.length, 0)
    exec.socketClose(opened.handle!)
  })

  it('send refuses a payload above the 64 KiB cap before touching the wire', async () => {
    const exec = new NetExecutor()
    const opened = await exec.socketOpen({ protocol: 'tcp', host: '127.0.0.1', port: tcpPort })
    assert.ok(opened.ok)
    const r = await exec.socketSend(opened.handle!, Buffer.alloc(64 * 1024 + 1))
    assert.equal(r.ok, false)
    assert.match(r.message, /exceeds the 65536-byte cap/)
    exec.socketClose(opened.handle!)
  })

  it('the session cap refuses the 33rd open session', async () => {
    const exec = new NetExecutor()
    const handles: string[] = []
    for (let i = 0; i < 32; i++) {
      const r = await exec.socketOpen({ protocol: 'tcp', host: '127.0.0.1', port: tcpPort })
      assert.ok(r.ok, `open ${i + 1}: ${r.message}`)
      handles.push(r.handle!)
    }
    const extra = await exec.socketOpen({ protocol: 'tcp', host: '127.0.0.1', port: tcpPort })
    assert.equal(extra.ok, false)
    assert.match(extra.message, /session cap reached/)
    exec.sessions.closeAll()
    assert.equal(exec.sessions.openCount, 0)
  })
})

describe('packet_send — nping route via injected spawn', () => {
  it('builds the argv runner-side, parses SENT/RCVD lines, records the reference packet', async () => {
    const calls: Array<{ file: string; args: string[] }> = []
    const spawn: SpawnFn = async (opts) => {
      calls.push({ file: opts.file, args: [...opts.args] })
      return {
        stdout: 'SENT (0.0123s) TCP 10.0.0.1:12345 > 10.0.0.2:80 S\nRCVD (0.0456s) TCP 10.0.0.2:80 > 10.0.0.1:12345 SA\n',
        stderr: '',
        code: 0,
        timedOut: false,
      }
    }
    const exec = new NetExecutor({ spawn, env: { REDTEAM_NPING_BIN: '/usr/bin/nping' } })
    const r = await exec.sendPacket(SYN_SPEC)
    assert.equal(calls.length, 1)
    assert.equal(calls[0]!.file, '/usr/bin/nping')
    assert.deepEqual(calls[0]!.args, [
      '--tcp', '-c', '2', '-p', '80', '-g', '12345', '--source-ip', '10.0.0.1',
      '--ttl', '64', '--id', '4660', '--flags', 'syn', '--seq', '1', '--win', '8192', '10.0.0.2',
    ])
    assert.ok(r.ok, r.message)
    assert.equal(r.sentLines, 1)
    assert.equal(r.replies.length, 1)
    assert.match(r.replies[0]!, /^RCVD/)
    assert.equal(r.referenceHex, SYN_PACKET_HEX)
  })

  it('a failing nping is reported honestly, never as a send', async () => {
    const spawn: SpawnFn = async () => ({
      stdout: '', stderr: 'nping: socket: Operation not permitted', code: 1, timedOut: false,
    })
    const exec = new NetExecutor({ spawn, env: { REDTEAM_NPING_BIN: '/usr/bin/nping' } })
    const r = await exec.sendPacket(SYN_SPEC)
    assert.equal(r.ok, false)
    assert.match(r.message, /nping did not send/)
    assert.equal(r.referenceHex, SYN_PACKET_HEX, 'the reference construction is still recorded')
  })
})

describe('flood — caps proven against a counting loopback target', () => {
  it('sustained rate never exceeds the cap and the run stops itself at the duration cap', async () => {
    const beforeCount = tcpConnections
    const fr = resolveFloodParams({ floodMode: 'tcp-connect', ratePerSec: 100, durationMs: 1200, concurrency: 8 })
    assert.ok(fr.ok)
    const exec = new NetExecutor()
    const r = await exec.flood({ host: '127.0.0.1', port: tcpPort, params: fr.params })
    assert.ok(r.ok, r.message)
    assert.equal(r.stoppedReason, 'duration cap')
    assert.ok(r.elapsedMs >= 1000, `ran to the cap, not less (${r.elapsedMs}ms)`)
    assert.ok(r.elapsedMs < 8000, `stopped at the cap, not beyond (${r.elapsedMs}ms)`)
    assert.ok(r.sent >= 50, `actually generated load (${r.sent} sends)`)
    // Slot-clock ceiling: at most rate x duration slots exist, plus one
    // in-flight batch of `concurrency` sends whose slots began in-window.
    assert.ok(r.sent <= 100 * 1.2 + 8 + 12, `rate ceiling held (${r.sent} sends in 1200ms at 100/s)`)
    const fixtureSaw = tcpConnections - beforeCount
    assert.ok(fixtureSaw <= r.sent, 'the fixture cannot see more than the executor sent')
    assert.ok(fixtureSaw >= r.sent - 8, `the fixture corroborates the count (${fixtureSaw} vs ${r.sent})`)
  })

  it('an abort halts a capped-max run mid-flight', async () => {
    const fr = resolveFloodParams({ floodMode: 'udp', ratePerSec: 1000, durationMs: 30000, concurrency: 16 })
    assert.ok(fr.ok)
    assert.equal(fr.params.ratePerSec, 1000)
    assert.equal(fr.params.durationMs, 30000)
    const exec = new NetExecutor()
    const ctrl = new AbortController()
    const running = exec.flood({ host: '127.0.0.1', port: udpPort, params: fr.params, signal: ctrl.signal })
    setTimeout(() => ctrl.abort(), 150)
    const r = await running
    assert.equal(r.stoppedReason, 'aborted')
    assert.ok(r.elapsedMs < 10000, `halted promptly (${r.elapsedMs}ms of a 30000ms run)`)
    assert.ok(r.sent < 1000 * 30, 'nowhere near the full-run volume')
  })
})
