/**
 * net_exec — packet construction + policy suite (pure, no I/O).
 *
 * The byte-exact expectations below were computed with an INDEPENDENT
 * reference implementation (Python struct + RFC 1071 checksum, itself
 * validated against the RFC's published worked example 0x220d) — not by
 * running the code under test. Construction being byte-exact is what lets
 * the runner record a reference packet for every nping send.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildIcmpMessage,
  buildIpv4Packet,
  buildTcpSegment,
  buildUdpDatagram,
  internetChecksum,
  parseIpv4,
  parseIpv4Packet,
  tcpByteToFlags,
  tcpFlagsToByte,
} from '../src/net/packets.js'
import {
  FLOOD_MAX_CONCURRENCY,
  FLOOD_MAX_DURATION_MS,
  FLOOD_MAX_PAYLOAD_BYTES,
  FLOOD_MAX_RATE_PER_SEC,
  buildNpingArgv,
  resolveFloodParams,
  resolveNpingBinary,
  validatePacketSpec,
  type PacketSpec,
} from '../src/net/policy.js'

describe('internetChecksum', () => {
  it('matches the RFC 1071 worked example', () => {
    assert.equal(internetChecksum(Buffer.from('0001f203f4f5f6f7', 'hex')), 0x220d)
  })
  it('handles odd-length buffers with a zero pad byte', () => {
    // 0x0102 + 0x0300 = 0x0402 -> complement 0xfbfd
    assert.equal(internetChecksum(Buffer.from('010203', 'hex')), 0xfbfd)
  })
  it('a header carrying its own checksum sums to zero', () => {
    const pkt = buildIpv4Packet({
      sourceIp: '10.0.0.1', destIp: '10.0.0.2', protocol: 6, payload: Buffer.alloc(0),
    })
    assert.equal(internetChecksum(pkt.subarray(0, 20)), 0)
  })
})

describe('tcp flag byte conversion', () => {
  it('maps names to wire bits and back', () => {
    assert.equal(tcpFlagsToByte(['syn']), 0x02)
    assert.equal(tcpFlagsToByte(['syn', 'ack']), 0x12)
    assert.equal(tcpFlagsToByte(['fin', 'psh', 'urg']), 0x29)
    assert.deepEqual(tcpByteToFlags(0x12), ['syn', 'ack'])
    assert.deepEqual(tcpByteToFlags(0xff), ['fin', 'syn', 'rst', 'psh', 'ack', 'urg', 'ece', 'cwr'])
  })
  it('refuses an unknown flag name with null', () => {
    assert.equal(tcpFlagsToByte(['syn', 'bogus']), null)
  })
})

describe('byte-exact packet construction (independent reference vectors)', () => {
  it('TCP SYN packet matches the reference bytes', () => {
    const seg = buildTcpSegment('10.0.0.1', '10.0.0.2', {
      sourcePort: 12345, destPort: 80, seq: 1, ack: 0, flags: ['syn'], window: 8192,
    })
    const pkt = buildIpv4Packet({
      sourceIp: '10.0.0.1', destIp: '10.0.0.2', protocol: 6, ttl: 64, identification: 0x1234, payload: seg,
    })
    assert.equal(
      pkt.toString('hex'),
      '45000028123440004006149a0a0000010a000002303900500000000100000000500220004b560000',
    )
  })
  it('TCP PSH+ACK packet with payload matches the reference bytes', () => {
    const seg = buildTcpSegment('192.168.0.10', '192.168.0.20', {
      sourcePort: 40000, destPort: 443, seq: 100, ack: 200, flags: ['psh', 'ack'], window: 4096,
      payload: Buffer.from('hi'),
    })
    const pkt = buildIpv4Packet({
      sourceIp: '192.168.0.10', destIp: '192.168.0.20', protocol: 6, ttl: 32, identification: 7, payload: seg,
    })
    assert.equal(
      pkt.toString('hex'),
      '4500002a000740002006d958c0a8000ac0a800149c4001bb00000064000000c85018100016cb00006869',
    )
  })
  it('UDP datagram packet matches the reference bytes', () => {
    const dg = buildUdpDatagram('10.1.1.1', '10.1.1.2', {
      sourcePort: 5353, destPort: 53, payload: Buffer.from('ab'),
    })
    const pkt = buildIpv4Packet({
      sourceIp: '10.1.1.1', destIp: '10.1.1.2', protocol: 17, payload: dg,
    })
    assert.equal(
      pkt.toString('hex'),
      '4500001e00004000401124cb0a0101010a01010214e90035000a73556162',
    )
  })
  it('ICMP echo packet matches the reference bytes', () => {
    const msg = buildIcmpMessage({ type: 8, code: 0, id: 0x1234, seq: 1, payload: Buffer.from('ping') })
    const pkt = buildIpv4Packet({
      sourceIp: '172.16.0.5', destIp: '172.16.0.6', protocol: 1, payload: msg,
    })
    assert.equal(
      pkt.toString('hex'),
      '45000020000040004001e2b1ac100005ac100006080006fa1234000170696e67',
    )
  })
  it('buildTcpSegment throws on an invalid flag instead of emitting a bad packet', () => {
    assert.throws(
      () => buildTcpSegment('10.0.0.1', '10.0.0.2', { sourcePort: 1, destPort: 2, flags: ['nope'] }),
      /invalid TCP flag/,
    )
  })
})

describe('parseIpv4Packet round-trip', () => {
  it('decodes the SYN reference packet field for field', () => {
    const parsed = parseIpv4Packet(
      Buffer.from('45000028123440004006149a0a0000010a000002303900500000000100000000500220004b560000', 'hex'),
    )
    assert.ok(parsed)
    assert.equal(parsed.sourceIp, '10.0.0.1')
    assert.equal(parsed.destIp, '10.0.0.2')
    assert.equal(parsed.protocol, 6)
    assert.equal(parsed.ttl, 64)
    assert.equal(parsed.identification, 0x1234)
    assert.equal(parsed.headerChecksumValid, true)
    assert.equal(parsed.sourcePort, 12345)
    assert.equal(parsed.destPort, 80)
    assert.deepEqual(parsed.tcpFlags, ['syn'])
    assert.equal(parsed.seq, 1)
    assert.equal(parsed.payload.length, 0)
  })
  it('decodes a UDP payload and an ICMP type', () => {
    const udp = parseIpv4Packet(
      Buffer.from('4500001e00004000401124cb0a0101010a01010214e90035000a73556162', 'hex'),
    )
    assert.equal(udp?.payload.toString(), 'ab')
    const icmp = parseIpv4Packet(
      Buffer.from('45000020000040004001e2b1ac100005ac100006080006fa1234000170696e67', 'hex'),
    )
    assert.equal(icmp?.icmpType, 8)
    assert.equal(icmp?.payload.toString(), 'ping')
  })
  it('returns null for non-IPv4 or truncated bytes', () => {
    assert.equal(parseIpv4Packet(Buffer.from('60000000', 'hex')), null)
    assert.equal(parseIpv4Packet(Buffer.alloc(10)), null)
  })
  it('parseIpv4 accepts dotted quads and refuses the rest', () => {
    assert.deepEqual(parseIpv4('192.168.0.1'), [192, 168, 0, 1])
    assert.equal(parseIpv4('256.0.0.1'), null)
    assert.equal(parseIpv4('example.com'), null)
  })
})

describe('validatePacketSpec', () => {
  it('accepts a minimal TCP spec and defaults count to 1', () => {
    const r = validatePacketSpec({ packetProtocol: 'tcp', destPort: 80 }, '10.0.0.2')
    assert.ok(r.ok)
    assert.equal(r.spec.count, 1)
    assert.equal(r.spec.destPort, 80)
  })
  it('refuses a hostname target — crafted packets never resolve names', () => {
    const r = validatePacketSpec({ packetProtocol: 'tcp', destPort: 80 }, 'example.com')
    assert.ok(!r.ok)
    assert.match(r.reason, /IPv4 literal/)
  })
  it('refuses tcp/udp without destPort, bad flags, oversized count and payload', () => {
    const noPort = validatePacketSpec({ packetProtocol: 'udp' }, '10.0.0.2')
    assert.ok(!noPort.ok)
    assert.match(noPort.reason, /requires destPort/)
    const badFlag = validatePacketSpec({ packetProtocol: 'tcp', destPort: 80, tcpFlags: ['syn', 'xmas'] }, '10.0.0.2')
    assert.ok(!badFlag.ok)
    const bigCount = validatePacketSpec({ packetProtocol: 'icmp', count: 11 }, '10.0.0.2')
    assert.ok(!bigCount.ok)
    const bigPayload = validatePacketSpec(
      { packetProtocol: 'udp', destPort: 53, payloadHex: 'aa'.repeat(4097) }, '10.0.0.2',
    )
    assert.ok(!bigPayload.ok)
    const oddHex = validatePacketSpec({ packetProtocol: 'udp', destPort: 53, payloadHex: 'abc' }, '10.0.0.2')
    assert.ok(!oddHex.ok)
  })
  it('refuses tcpFlags on a non-TCP packet', () => {
    const r = validatePacketSpec({ packetProtocol: 'udp', destPort: 53, tcpFlags: ['syn'] }, '10.0.0.2')
    assert.ok(!r.ok)
  })
})

describe('buildNpingArgv', () => {
  it('builds the full TCP argv runner-side, target last', () => {
    const spec: PacketSpec = {
      protocol: 'tcp', destIp: '10.0.0.2', sourceIp: '10.0.0.1', sourcePort: 12345, destPort: 80,
      tcpFlags: ['syn', 'ack'], seq: 1, ack: 2, window: 8192, ttl: 64, identification: 4660,
      payloadHex: '6869', count: 2,
    }
    assert.deepEqual(buildNpingArgv('/usr/bin/nping', spec), [
      '/usr/bin/nping', '--tcp', '-c', '2', '-p', '80', '-g', '12345',
      '--source-ip', '10.0.0.1', '--ttl', '64', '--id', '4660',
      '--flags', 'syn,ack', '--seq', '1', '--ack', '2', '--win', '8192',
      '--data', '6869', '10.0.0.2',
    ])
  })
  it('builds the ICMP argv with echo fields and no port', () => {
    const spec: PacketSpec = {
      protocol: 'icmp', destIp: '10.0.0.2', icmpType: 8, icmpCode: 0, icmpId: 4660, icmpSeq: 3, count: 1,
    }
    assert.deepEqual(buildNpingArgv('nping', spec), [
      'nping', '--icmp', '-c', '1', '--icmp-type', '8', '--icmp-code', '0',
      '--icmp-id', '4660', '--icmp-seq', '3', '10.0.0.2',
    ])
  })
})

describe('resolveNpingBinary', () => {
  it('the explicit env override wins', () => {
    assert.equal(resolveNpingBinary({ REDTEAM_NPING_BIN: '/x/nping' }), '/x/nping')
  })
})

describe('resolveFloodParams — the hard caps', () => {
  it('clamps every above-cap value DOWN to the constants and names each clamp', () => {
    const r = resolveFloodParams({
      floodMode: 'udp', ratePerSec: 99999, durationMs: 999999, concurrency: 9999, payloadBytes: 99999,
    })
    assert.ok(r.ok)
    assert.equal(r.params.ratePerSec, FLOOD_MAX_RATE_PER_SEC)
    assert.equal(r.params.durationMs, FLOOD_MAX_DURATION_MS)
    assert.equal(r.params.concurrency, FLOOD_MAX_CONCURRENCY)
    assert.equal(r.params.payloadBytes, FLOOD_MAX_PAYLOAD_BYTES)
    assert.equal(r.params.clamped.length, 4)
  })
  it('passes in-cap values through untouched with no clamps recorded', () => {
    const r = resolveFloodParams({ floodMode: 'tcp-data', ratePerSec: 50, durationMs: 1000, concurrency: 4, payloadBytes: 128 })
    assert.ok(r.ok)
    assert.equal(r.params.ratePerSec, 50)
    assert.deepEqual(r.params.clamped, [])
  })
  it('refuses non-positive and non-integer values instead of rewriting them', () => {
    assert.ok(!resolveFloodParams({ ratePerSec: 0 }).ok)
    assert.ok(!resolveFloodParams({ ratePerSec: 2.5 }).ok)
    assert.ok(!resolveFloodParams({ durationMs: -5 }).ok)
    assert.ok(!resolveFloodParams({ floodMode: 'syn' }).ok)
  })
})
