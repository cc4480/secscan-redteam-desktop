/**
 * Crafted-packet construction and parsing (pure — no I/O).
 *
 * The packet crafter's canonical form: a structured spec goes in, the exact
 * IPv4 packet bytes come out. Construction is byte-exact and testable
 * without a network or privileges; the executor hands the SAME spec to
 * nping (the wire sender) and records these bytes as the reference for what
 * was specified. Parsing is the mirror: captured IPv4 bytes decode back to
 * the fields an agent can cite as evidence.
 *
 * IPv4 only. TCP/UDP/ICMP payloads; checksums computed per RFC 791/768/
 * 793/792 (one's-complement sum over header + pseudo-header where defined).
 */
export const IP_PROTO_ICMP = 1;
export const IP_PROTO_TCP = 6;
export const IP_PROTO_UDP = 17;
/** TCP flag names in wire order (byte bits 0x01..0x80). */
export const TCP_FLAG_NAMES = ["fin", "syn", "rst", "psh", "ack", "urg", "ece", "cwr"];
const FLAG_BITS = {
    fin: 0x01, syn: 0x02, rst: 0x04, psh: 0x08, ack: 0x10, urg: 0x20, ece: 0x40, cwr: 0x80,
};
/** Flag byte for a list of flag names, or null when a name is not a TCP flag. */
export function tcpFlagsToByte(names) {
    let byte = 0;
    for (const n of names) {
        const bit = FLAG_BITS[n.toLowerCase()];
        if (bit === undefined)
            return null;
        byte |= bit;
    }
    return byte;
}
/** Flag names set in a TCP flag byte, in wire order. */
export function tcpByteToFlags(byte) {
    return TCP_FLAG_NAMES.filter((n) => (byte & FLAG_BITS[n]) !== 0);
}
/** Parse a dotted-quad IPv4 literal to its 4 octets, or null. */
export function parseIpv4(ip) {
    const parts = ip.trim().split(".");
    if (parts.length !== 4)
        return null;
    const octets = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
    if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255))
        return null;
    return octets;
}
export function formatIpv4(octets) {
    return `${octets[0]}.${octets[1]}.${octets[2]}.${octets[3]}`;
}
/** RFC 1071 one's-complement checksum over a buffer (odd byte zero-padded). */
export function internetChecksum(buf) {
    let sum = 0;
    for (let i = 0; i + 1 < buf.length; i += 2)
        sum += buf.readUInt16BE(i);
    if (buf.length % 2 === 1)
        sum += buf[buf.length - 1] << 8;
    while (sum > 0xffff)
        sum = (sum & 0xffff) + (sum >> 16);
    return (~sum) & 0xffff;
}
function pseudoHeader(srcIp, dstIp, protocol, length) {
    const ph = Buffer.alloc(12);
    Buffer.from(parseIpv4(srcIp)).copy(ph, 0);
    Buffer.from(parseIpv4(dstIp)).copy(ph, 4);
    ph[8] = 0;
    ph[9] = protocol;
    ph.writeUInt16BE(length, 10);
    return ph;
}
/** Build one TCP segment (header + payload) with a valid checksum. */
export function buildTcpSegment(srcIp, dstIp, spec) {
    const payload = spec.payload ?? Buffer.alloc(0);
    const flagByte = tcpFlagsToByte(spec.flags);
    if (flagByte === null)
        throw new Error(`invalid TCP flag in ${JSON.stringify(spec.flags)}`);
    const seg = Buffer.alloc(20 + payload.length);
    seg.writeUInt16BE(spec.sourcePort, 0);
    seg.writeUInt16BE(spec.destPort, 2);
    seg.writeUInt32BE((spec.seq ?? 0) >>> 0, 4);
    seg.writeUInt32BE((spec.ack ?? 0) >>> 0, 8);
    seg[12] = 5 << 4; // data offset 5 words, no options
    seg[13] = flagByte;
    seg.writeUInt16BE(spec.window ?? 8192, 14);
    payload.copy(seg, 20);
    const sum = internetChecksum(Buffer.concat([pseudoHeader(srcIp, dstIp, IP_PROTO_TCP, seg.length), seg]));
    seg.writeUInt16BE(sum, 16);
    return seg;
}
/** Build one UDP datagram with a valid checksum (0 computed → sent as 0xffff per RFC 768). */
export function buildUdpDatagram(srcIp, dstIp, spec) {
    const payload = spec.payload ?? Buffer.alloc(0);
    const dg = Buffer.alloc(8 + payload.length);
    dg.writeUInt16BE(spec.sourcePort, 0);
    dg.writeUInt16BE(spec.destPort, 2);
    dg.writeUInt16BE(dg.length, 4);
    payload.copy(dg, 8);
    const sum = internetChecksum(Buffer.concat([pseudoHeader(srcIp, dstIp, IP_PROTO_UDP, dg.length), dg]));
    dg.writeUInt16BE(sum === 0 ? 0xffff : sum, 6);
    return dg;
}
/** Build one ICMP message with a valid checksum. */
export function buildIcmpMessage(spec) {
    const payload = spec.payload ?? Buffer.alloc(0);
    const msg = Buffer.alloc(8 + payload.length);
    msg[0] = spec.type;
    msg[1] = spec.code ?? 0;
    msg.writeUInt16BE(spec.id ?? 0, 4);
    msg.writeUInt16BE(spec.seq ?? 0, 6);
    payload.copy(msg, 8);
    msg.writeUInt16BE(internetChecksum(msg), 2);
    return msg;
}
/** Wrap a transport payload in an IPv4 header with a valid header checksum. */
export function buildIpv4Packet(spec) {
    const header = Buffer.alloc(20);
    header[0] = 0x45; // version 4, IHL 5 (no options)
    header.writeUInt16BE(20 + spec.payload.length, 2);
    header.writeUInt16BE(spec.identification ?? 0, 4);
    header.writeUInt16BE(0x4000, 6); // DF set, fragment offset 0
    header[8] = spec.ttl ?? 64;
    header[9] = spec.protocol;
    Buffer.from(parseIpv4(spec.sourceIp)).copy(header, 12);
    Buffer.from(parseIpv4(spec.destIp)).copy(header, 16);
    header.writeUInt16BE(internetChecksum(header), 10);
    return Buffer.concat([header, spec.payload]);
}
/** Decode one IPv4 packet. Returns null when the bytes are not a complete IPv4 packet. */
export function parseIpv4Packet(buf) {
    if (buf.length < 20 || buf[0] >> 4 !== 4)
        return null;
    const ihl = (buf[0] & 0x0f) * 4;
    if (ihl < 20 || buf.length < ihl)
        return null;
    const totalLength = buf.readUInt16BE(2);
    const end = totalLength >= ihl && totalLength <= buf.length ? totalLength : buf.length;
    const protocol = buf[9];
    const out = {
        sourceIp: formatIpv4(buf.subarray(12, 16)),
        destIp: formatIpv4(buf.subarray(16, 20)),
        protocol,
        ttl: buf[8],
        identification: buf.readUInt16BE(4),
        totalLength,
        headerChecksumValid: internetChecksum(buf.subarray(0, ihl)) === 0,
        payload: Buffer.from(buf.subarray(ihl, end)),
    };
    const body = out.payload;
    if ((protocol === IP_PROTO_TCP || protocol === IP_PROTO_UDP) && body.length >= 4) {
        out.sourcePort = body.readUInt16BE(0);
        out.destPort = body.readUInt16BE(2);
    }
    if (protocol === IP_PROTO_TCP && body.length >= 14) {
        out.tcpFlags = tcpByteToFlags(body[13]);
        out.seq = body.readUInt32BE(4);
        out.ack = body.readUInt32BE(8);
        const dataOffset = ((body[12] >> 4) & 0x0f) * 4;
        out.payload = Buffer.from(body.subarray(Math.max(20, dataOffset)));
    }
    else if (protocol === IP_PROTO_UDP && body.length >= 8) {
        out.payload = Buffer.from(body.subarray(8));
    }
    else if (protocol === IP_PROTO_ICMP && body.length >= 4) {
        out.icmpType = body[0];
        out.icmpCode = body[1];
        out.payload = Buffer.from(body.subarray(8));
    }
    return out;
}
//# sourceMappingURL=packets.js.map