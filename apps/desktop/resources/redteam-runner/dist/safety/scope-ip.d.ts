/**
 * IP parsing for the scope guard — the subset of Python's `ipaddress`
 * module the guard relies on, implemented over BigInt so IPv6 networks
 * compare exactly. Strictness mirrors `ipaddress.ip_address`: dotted
 * decimal IPv4 with no leading zeros, IPv6 with `::` compression and
 * embedded IPv4 tails, and `ip_network(..., strict=False)` masking.
 */
interface ParsedIp {
  version: 4 | 6
  /** Address value; 32-bit range for v4, 128-bit for v6. */
  value: bigint
  /** Canonical text form (what Python's str() of the address produces). */
  text: string
}
/**
 * Parse a strict IPv4 literal, mirroring `ipaddress.ip_address`: dotted
 * decimal, each octet 0–255, no leading zeros except "0" itself.
 *
 * @param s - Candidate address text.
 * @returns The parsed address, or undefined when `s` is not an IPv4 literal.
 */
export declare function parseIPv4(s: string): ParsedIp | undefined
/**
 * Parse an IPv6 literal, mirroring `ipaddress.ip_address`: hex groups with
 * optional `::` compression and an optional embedded IPv4 tail.
 *
 * @param s - Candidate address text.
 * @returns The parsed address (canonical compressed text), or undefined.
 */
export declare function parseIPv6(s: string): ParsedIp | undefined
/**
 * Parse either address family, mirroring `ipaddress.ip_address`.
 *
 * @param s - Candidate address text (brackets already stripped by callers).
 * @returns The parsed address, or undefined when `s` is not an IP literal.
 */
export declare function parseIp(s: string): ParsedIp | undefined
export interface ParsedNetwork {
  version: 4 | 6
  base: bigint
  prefix: number
  /** Canonical "address/prefix" text (host bits masked, as ip_network). */
  text: string
}
/**
 * Parse a CIDR, mirroring `ipaddress.ip_network(entry, strict=False)`:
 * host bits are masked off rather than rejected.
 *
 * @param s - Candidate "address/prefix" text.
 * @returns The parsed network, or undefined when unparseable.
 */
export declare function parseNetwork(s: string): ParsedNetwork | undefined
/**
 * True when `ip` falls inside `net` (families must match, as in Python).
 *
 * @param net - The network to test against.
 * @param ip - The address to test.
 * @returns Whether the address is a member of the network.
 */
export declare function networkContains(net: ParsedNetwork, ip: ParsedIp): boolean
/** Dotted-quad shape (not validity — octets are range-checked in parseIPv4). */
export declare const IPV4_RE: RegExp
/** Dotted-quad CIDR shape. */
export declare const IPV4_CIDR_RE: RegExp
export {}
