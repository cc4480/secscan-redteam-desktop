/**
 * Address parsing + deny-by-range classification — extracted from
 * `fetch-guard.ts` so the parent module stays inside the runner's 300-line
 * file budget. Pure functions (spec §6.1.3); the parent's public surface is
 * unchanged — these were module-private before the extraction.
 */

export function stripBrackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname
}

/* ------------------------------------------------------------------ */
/* Address classification — deny-by-range (spec §6.1.3).               */
/* A parsed address is either public (blocked === null) or carries     */
/* the category of the non-global range it falls in. Unparseable        */
/* input returns null from parseIpAddress and is denied fail-closed.    */
/* ------------------------------------------------------------------ */

export interface CheckedAddress {
  family: 4 | 6
  /** Normalized form handed to the transport as the pinned address. */
  canonical: string
  blocked: string | null
}

export function parseIpAddress(raw: string): CheckedAddress | null {
  const v4 = parseIPv4(raw)
  if (v4 !== null) {
    return { family: 4, canonical: v4.join('.'), blocked: classifyIPv4(v4) }
  }
  const v6 = parseIPv6(raw)
  if (v6 !== null) {
    return { family: 6, canonical: raw.toLowerCase(), blocked: classifyIPv6(v6) }
  }
  return null
}

/** Strict dotted-quad: decimal octets, no leading zeros (octal ambiguity). */
function parseIPv4(raw: string): [number, number, number, number] | null {
  const parts = raw.split('.')
  if (parts.length !== 4) return null
  const octets: number[] = []
  for (const part of parts) {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(part)) return null
    const value = Number(part)
    if (value > 255) return null
    octets.push(value)
  }
  return [octets[0], octets[1], octets[2], octets[3]]
}

/** Full IPv6 parser: `::` compression at most once, optional trailing embedded IPv4. */
function parseIPv6(raw: string): number[] | null {
  if (raw === '' || raw.includes('%')) return null // zone ids are never acceptable
  let input = raw
  if (input.includes('.')) {
    // Embedded dotted-quad in the low 32 bits: rewrite it as two hex groups.
    const lastColon = input.lastIndexOf(':')
    if (lastColon < 0) return null
    const embedded = parseIPv4(input.slice(lastColon + 1))
    if (embedded === null) return null
    const hi = ((embedded[0] << 8) | embedded[1]).toString(16)
    const lo = ((embedded[2] << 8) | embedded[3]).toString(16)
    input = `${input.slice(0, lastColon)}:${hi}:${lo}`
  }
  return parseIPv6Groups(input)
}

function parseIPv6Groups(input: string): number[] | null {
  const halves = input.split('::')
  if (halves.length > 2) return null
  const parseSide = (side: string): number[] | null => {
    if (side === '') return []
    const groups: number[] = []
    for (const part of side.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return null
      groups.push(parseInt(part, 16))
    }
    return groups
  }
  const left = parseSide(halves[0])
  if (left === null) return null
  if (halves.length === 1) {
    return left.length === 8 ? left : null
  }
  const right = parseSide(halves[1])
  if (right === null) return null
  const missing = 8 - left.length - right.length
  if (missing < 1) return null // "::" must compress at least one group
  return [...left, ...new Array<number>(missing).fill(0), ...right]
}

function classifyIPv4([a, b, c]: [number, number, number, number]): string | null {
  if (a === 0) return 'unspecified (0.0.0.0/8)'
  if (a === 10) return 'private (10.0.0.0/8)'
  if (a === 100 && b >= 64 && b <= 127) return 'shared address space (100.64.0.0/10)'
  if (a === 127) return 'loopback (127.0.0.0/8)'
  if (a === 169 && b === 254) return 'link-local (169.254.0.0/16)'
  if (a === 172 && b >= 16 && b <= 31) return 'private (172.16.0.0/12)'
  if (a === 192 && b === 0 && c === 0) return 'reserved (192.0.0.0/24)'
  if (a === 192 && b === 0 && c === 2) return 'documentation (192.0.2.0/24)'
  if (a === 192 && b === 88 && c === 99) return 'reserved (192.88.99.0/24)'
  if (a === 192 && b === 168) return 'private (192.168.0.0/16)'
  if (a === 198 && (b === 18 || b === 19)) return 'benchmarking (198.18.0.0/15)'
  if (a === 198 && b === 51 && c === 100) return 'documentation (198.51.100.0/24)'
  if (a === 203 && b === 0 && c === 113) return 'documentation (203.0.113.0/24)'
  if (a >= 224 && a <= 239) return 'multicast (224.0.0.0/4)'
  if (a >= 240) return 'reserved (240.0.0.0/4)'
  return null
}

function classifyIPv6(h: number[]): string | null {
  const [h0, h1, h2, h3, h4, h5, h6, h7] = h as [
    number, number, number, number, number, number, number, number,
  ]
  if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0 && h6 === 0) {
    if (h7 === 0) return 'unspecified (::/128)'
    if (h7 === 1) return 'loopback (::1/128)'
  }
  // IPv4-embedded forms are judged by the address they actually reach.
  const embeddedBlocked = (): string | null =>
    classifyIPv4([
      (h6 >> 8) & 0xff,
      h6 & 0xff,
      (h7 >> 8) & 0xff,
      h7 & 0xff,
    ])
  if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0) {
    if (h5 === 0xffff) {
      // ::ffff:0:0/96 — IPv4-mapped.
      return embeddedBlocked()
    }
    if (h5 === 0) {
      // ::/96 — deprecated IPv4-compatible (covers :: and ::1 as embedded v4).
      return embeddedBlocked()
    }
  }
  if (h0 === 0x0064 && h1 === 0xff9b) {
    if (h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0) {
      // 64:ff9b::/96 — NAT64 well-known prefix; judge the embedded IPv4.
      return embeddedBlocked()
    }
    return 'reserved (64:ff9b:1::/48 NAT64 local-use)'
  }
  if ((h0 & 0xfe00) === 0xfc00) return 'private (fc00::/7)'
  if ((h0 & 0xffc0) === 0xfe80) return 'link-local (fe80::/10)'
  if ((h0 & 0xffc0) === 0xfec0) return 'reserved (fec0::/10 site-local, deprecated)'
  if ((h0 & 0xff00) === 0xff00) return 'multicast (ff00::/8)'
  if (h0 === 0x0100 && h1 === 0 && h2 === 0 && h3 === 0) {
    return 'reserved (100::/64 discard-only)'
  }
  if (h0 === 0x2001 && h1 === 0x0000) return 'reserved (2001::/32 Teredo)'
  if (h0 === 0x2001 && h1 === 0x0002) return 'benchmarking (2001:2::/48)'
  if (h0 === 0x2001 && h1 === 0x0db8) return 'documentation (2001:db8::/32)'
  if (h0 === 0x2001 && (h1 & 0xfff0) === 0x0010) return 'reserved (2001:10::/28 ORCHID)'
  if (h0 === 0x2002) return 'reserved (2002::/16 6to4)'
  // Backstop: global unicast is 2000::/3. Anything outside it that was not
  // already judged above (embedded forms, ULA, link-local, multicast) is
  // IETF-reserved or unallocated — not a public destination.
  if ((h0 & 0xe000) !== 0x2000) return 'reserved (outside 2000::/3 global unicast)'
  return null
}
