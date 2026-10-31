/**
 * IP parsing for the scope guard — the subset of Python's `ipaddress`
 * module the guard relies on, implemented over BigInt so IPv6 networks
 * compare exactly. Strictness mirrors `ipaddress.ip_address`: dotted
 * decimal IPv4 with no leading zeros, IPv6 with `::` compression and
 * embedded IPv4 tails, and `ip_network(..., strict=False)` masking.
 */
// ---------------------------------------------------------------------------
// IP parsing (the subset of Python's `ipaddress` the guard relies on)
// ---------------------------------------------------------------------------

interface ParsedIp {
  version: 4 | 6;
  /** Address value; 32-bit range for v4, 128-bit for v6. */
  value: bigint;
  /** Canonical text form (what Python's str() of the address produces). */
  text: string;
}

/**
 * Parse a strict IPv4 literal, mirroring `ipaddress.ip_address`: dotted
 * decimal, each octet 0–255, no leading zeros except "0" itself.
 *
 * @param s - Candidate address text.
 * @returns The parsed address, or undefined when `s` is not an IPv4 literal.
 */
export function parseIPv4(s: string): ParsedIp | undefined {
  const parts = s.split(".");
  if (parts.length !== 4) return undefined;
  let value = 0n;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return undefined;
    if (p.length > 1 && p.startsWith("0")) return undefined;
    const n = Number(p);
    if (n > 255) return undefined;
    value = (value << 8n) | BigInt(n);
  }
  return { version: 4, value, text: parts.map((p) => String(Number(p))).join(".") };
}

/**
 * Parse an IPv6 literal, mirroring `ipaddress.ip_address`: hex groups with
 * optional `::` compression and an optional embedded IPv4 tail.
 *
 * @param s - Candidate address text.
 * @returns The parsed address (canonical compressed text), or undefined.
 */
export function parseIPv6(s: string): ParsedIp | undefined {
  let input = s;
  if (input.includes("%")) return undefined; // zone ids: ipaddress accepts them only on scoped forms the guard never lists
  let v4Tail: bigint | undefined;
  const lastColon = input.lastIndexOf(":");
  if (lastColon >= 0 && input.slice(lastColon + 1).includes(".")) {
    const v4 = parseIPv4(input.slice(lastColon + 1));
    if (!v4) return undefined;
    v4Tail = v4.value;
    input = input.slice(0, lastColon + 1) + "0:0";
  }
  const halves = input.split("::");
  if (halves.length > 2) return undefined;
  const parseGroups = (text: string): bigint[] | undefined => {
    if (text === "") return [];
    const out: bigint[] = [];
    for (const g of text.split(":")) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return undefined;
      out.push(BigInt(`0x${g}`));
    }
    return out;
  };
  const left = parseGroups(halves[0]);
  if (!left) return undefined;
  let groups: bigint[];
  if (halves.length === 2) {
    const right = parseGroups(halves[1]);
    if (!right) return undefined;
    const missing = 8 - left.length - right.length;
    if (missing < 1) return undefined; // "::" must compress at least one group
    groups = [...left, ...Array.from({ length: missing }, () => 0n), ...right];
  } else {
    if (left.length !== 8) return undefined;
    groups = left;
  }
  if (v4Tail !== undefined) {
    groups[6] = v4Tail >> 16n;
    groups[7] = v4Tail & 0xffffn;
  }
  let value = 0n;
  for (const g of groups) value = (value << 16n) | g;
  return { version: 6, value, text: canonicalIPv6(groups) };
}

/** RFC 5952-style canonical text: lowercase, longest zero run (≥2) as `::`. */
function canonicalIPv6(groups: bigint[]): string {
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;
  for (let i = 0; i < 8; i++) {
    if (groups[i] === 0n) {
      if (curStart < 0) curStart = i;
      curLen++;
      if (curLen > bestLen) {
        bestStart = curStart;
        bestLen = curLen;
      }
    } else {
      curStart = -1;
      curLen = 0;
    }
  }
  const hex = groups.map((g) => g.toString(16));
  if (bestLen < 2) return hex.join(":");
  const before = hex.slice(0, bestStart).join(":");
  const after = hex.slice(bestStart + bestLen).join(":");
  return `${before}::${after}`;
}

/**
 * Parse either address family, mirroring `ipaddress.ip_address`.
 *
 * @param s - Candidate address text (brackets already stripped by callers).
 * @returns The parsed address, or undefined when `s` is not an IP literal.
 */
export function parseIp(s: string): ParsedIp | undefined {
  return s.includes(":") ? parseIPv6(s) : parseIPv4(s);
}

export interface ParsedNetwork {
  version: 4 | 6;
  base: bigint;
  prefix: number;
  /** Canonical "address/prefix" text (host bits masked, as ip_network). */
  text: string;
}

/**
 * Parse a CIDR, mirroring `ipaddress.ip_network(entry, strict=False)`:
 * host bits are masked off rather than rejected.
 *
 * @param s - Candidate "address/prefix" text.
 * @returns The parsed network, or undefined when unparseable.
 */
export function parseNetwork(s: string): ParsedNetwork | undefined {
  const slash = s.lastIndexOf("/");
  if (slash < 0) return undefined;
  const addrText = s.slice(0, slash);
  const prefixText = s.slice(slash + 1);
  if (!/^\d{1,3}$/.test(prefixText)) return undefined;
  const ip = parseIp(addrText.trim());
  if (!ip) return undefined;
  const bits = ip.version === 4 ? 32 : 128;
  const prefix = Number(prefixText);
  if (prefix > bits) return undefined;
  const shift = BigInt(bits - prefix);
  const base = (ip.value >> shift) << shift;
  const text =
    ip.version === 4
      ? `${[24, 16, 8, 0].map((o) => String((base >> BigInt(o)) & 0xffn)).join(".")}/${prefix}`
      : `${canonicalIPv6(Array.from({ length: 8 }, (_, i) => (base >> BigInt(112 - 16 * i)) & 0xffffn))}/${prefix}`;
  return { version: ip.version, base, prefix, text };
}

/**
 * True when `ip` falls inside `net` (families must match, as in Python).
 *
 * @param net - The network to test against.
 * @param ip - The address to test.
 * @returns Whether the address is a member of the network.
 */
export function networkContains(net: ParsedNetwork, ip: ParsedIp): boolean {
  if (ip.version !== net.version) return false;
  const bits = net.version === 4 ? 32 : 128;
  const shift = BigInt(bits - net.prefix);
  return ip.value >> shift === net.base >> shift;
}

/** Dotted-quad shape (not validity — octets are range-checked in parseIPv4). */
export const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;
/** Dotted-quad CIDR shape. */
export const IPV4_CIDR_RE = /^\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}$/;
