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
export declare const IP_PROTO_ICMP = 1;
export declare const IP_PROTO_TCP = 6;
export declare const IP_PROTO_UDP = 17;
/** TCP flag names in wire order (byte bits 0x01..0x80). */
export declare const TCP_FLAG_NAMES: readonly ["fin", "syn", "rst", "psh", "ack", "urg", "ece", "cwr"];
export type TcpFlagName = (typeof TCP_FLAG_NAMES)[number];
/** Flag byte for a list of flag names, or null when a name is not a TCP flag. */
export declare function tcpFlagsToByte(names: readonly string[]): number | null;
/** Flag names set in a TCP flag byte, in wire order. */
export declare function tcpByteToFlags(byte: number): TcpFlagName[];
/** Parse a dotted-quad IPv4 literal to its 4 octets, or null. */
export declare function parseIpv4(ip: string): [number, number, number, number] | null;
export declare function formatIpv4(octets: ArrayLike<number>): string;
/** RFC 1071 one's-complement checksum over a buffer (odd byte zero-padded). */
export declare function internetChecksum(buf: Buffer): number;
export interface TcpSegmentSpec {
    sourcePort: number;
    destPort: number;
    seq?: number;
    ack?: number;
    flags: readonly string[];
    window?: number;
    payload?: Buffer;
}
/** Build one TCP segment (header + payload) with a valid checksum. */
export declare function buildTcpSegment(srcIp: string, dstIp: string, spec: TcpSegmentSpec): Buffer;
export interface UdpDatagramSpec {
    sourcePort: number;
    destPort: number;
    payload?: Buffer;
}
/** Build one UDP datagram with a valid checksum (0 computed → sent as 0xffff per RFC 768). */
export declare function buildUdpDatagram(srcIp: string, dstIp: string, spec: UdpDatagramSpec): Buffer;
export interface IcmpMessageSpec {
    type: number;
    code?: number;
    /** Echo identifier (types 0/8); other types carry it in the rest-of-header too. */
    id?: number;
    /** Echo sequence number. */
    seq?: number;
    payload?: Buffer;
}
/** Build one ICMP message with a valid checksum. */
export declare function buildIcmpMessage(spec: IcmpMessageSpec): Buffer;
export interface Ipv4PacketSpec {
    sourceIp: string;
    destIp: string;
    protocol: number;
    ttl?: number;
    identification?: number;
    payload: Buffer;
}
/** Wrap a transport payload in an IPv4 header with a valid header checksum. */
export declare function buildIpv4Packet(spec: Ipv4PacketSpec): Buffer;
export interface ParsedPacket {
    sourceIp: string;
    destIp: string;
    protocol: number;
    ttl: number;
    identification: number;
    totalLength: number;
    headerChecksumValid: boolean;
    sourcePort?: number;
    destPort?: number;
    tcpFlags?: TcpFlagName[];
    seq?: number;
    ack?: number;
    icmpType?: number;
    icmpCode?: number;
    payload: Buffer;
}
/** Decode one IPv4 packet. Returns null when the bytes are not a complete IPv4 packet. */
export declare function parseIpv4Packet(buf: Buffer): ParsedPacket | null;
