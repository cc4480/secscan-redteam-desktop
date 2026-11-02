/**
 * Address policy shared by the prober and its DNS-pinned transport.
 *
 * Kept apart from prober-net.ts so the resolver/pinning code stays within the
 * repository's per-file budget; the rules themselves are the same ones
 * validateProbeTarget has always applied before any packet is sent.
 */

/** Literal private-range / loopback host, by name or address (pre-resolution guard). */
export const PRIVATE_HOST =
  /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[::1\]|::1$)/i

/** True when `host` is a literal private-range or loopback address/name. */
export function isPrivateOrLoopbackHost(host: string): boolean {
  return PRIVATE_HOST.test(host.toLowerCase())
}

/**
 * True when every host is private/loopback (and there is at least one).
 *
 * Local sandbox mode skips ownership verification for a private target, so it may only
 * widen the prober to private hosts when the WHOLE scope is private: a loopback target
 * combined with a public scope host must not inherit the sandbox bypass.
 */
export function allHostsPrivateOrLoopback(hosts: readonly string[]): boolean {
  return hosts.length > 0 && hosts.every(h => isPrivateOrLoopbackHost(h))
}

export interface ValidateProbeTargetOptions {
  /**
   * LOCAL SANDBOX MODE ONLY. When true, a private/loopback host that is also
   * an exact in-scope host is allowed. This never widens the scope check —
   * it only lifts the private-IP rejection for a host you explicitly put in
   * the ROE. Never set this for an engagement against a real domain: it has
   * no effect there (the host still has to resolve as private/loopback to
   * qualify), but it should never be on by default or implied by anything
   * other than an explicit, separate opt-in flag.
   */
  allowPrivateHosts?: boolean
  /**
   * The verified engagement record's verdict for a host (see
   * safety/attested-host.ts). When it allows the host, the private/
   * loopback rejection is lifted for that host exactly as under
   * allowPrivateHosts — the attested record is the authorization, so a
   * lab or LAN target the owner verified is reachable without the
   * sandbox flag. Consulted per host, only for this rejection: the
   * scope-membership check below is unchanged, and link-local stays
   * refused unconditionally.
   */
  attestedHost?: (host: string) => boolean
}

/**
 * The prober's pre-flight target validation: scheme, link-local,
 * private/loopback, and exact scope membership, in that order — every
 * refusal lands before any packet is sent.
 */
export function validateProbeTarget(
  url: string,
  scopeHosts: string[],
  opts: ValidateProbeTargetOptions = {},
): { ok: true } | { ok: false; reason: string } {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return { ok: false, reason: `unparseable URL: ${url}` }
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, reason: `scheme not allowed: ${u.protocol}` }
  }
  const host = u.hostname.toLowerCase()
  // Link-local literals (cloud metadata 169.254.169.254, fe80::/10) are
  // refused unconditionally — no allowance must ever open metadata.
  if (/^169\.254\.|^\[?fe[89ab][0-9a-f]:/i.test(host)) {
    return { ok: false, reason: `link-local host rejected (never allowed, incl. sandbox): ${host}` }
  }
  if (isPrivateOrLoopbackHost(host) && !opts.allowPrivateHosts && !opts.attestedHost?.(host)) {
    return { ok: false, reason: `private/loopback host rejected: ${host}` }
  }
  if (!scopeHosts.includes(host)) {
    return { ok: false, reason: `out of scope: ${host} (scope: ${scopeHosts.join(', ')})` }
  }
  return { ok: true }
}
