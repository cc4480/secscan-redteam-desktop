/**
 * Target validation guard for scan intake and the scan worker.
 *
 * Every scan target goes through `assertTargetSafe` before a job is queued
 * (route) and again right before probing starts (worker, to close the
 * resolve→request TOCTOU window). `validatedFetch` applies the same checks to
 * every redirect hop.
 *
 * The rule is simple: the scanner only ever talks to public IP addresses over
 * http/https, on an allowlisted port, with no credentials in the URL.
 */

export class TargetValidationError extends Error {
  readonly code:
    | "bad_url"
    | "bad_protocol"
    | "credentials_in_url"
    | "port_not_allowed"
    | "empty_hostname"
    | "ip_literal_not_allowed"
    | "private_ip"
    | "dns_failed"
    | "too_many_redirects"
    | "redirect_rejected"
    | "request_failed";

  constructor(code: TargetValidationError["code"], message: string) {
    super(message);
    this.name = "TargetValidationError";
    this.code = code;
  }
}

/** Ports the scanner is willing to probe. Everything else is rejected. */
export const ALLOWED_TARGET_PORTS = new Set([80, 443, 3000, 8000, 8080, 8443]);

const MAX_REDIRECTS = 5;

/* ─── IP classification ─────────────────────────────────────────────────── */

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = (n << 8) + v;
  }
  return n >>> 0;
}

function inCidrV4(ip: string, cidr: string): boolean {
  const [base, bitsStr] = cidr.split("/");
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  const bits = Number(bitsStr);
  if (ipInt === null || baseInt === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

/** Non-public IPv4 ranges (RFC 1122/1918/3927/6598/6890 et al). */
const PRIVATE_V4_CIDRS = [
  "0.0.0.0/8",       // software scope ("this host")
  "10.0.0.0/8",      // RFC1918
  "100.64.0.0/10",   // CGNAT
  "127.0.0.0/8",     // loopback
  "169.254.0.0/16",  // link-local (includes cloud metadata 169.254.169.254)
  "172.16.0.0/12",   // RFC1918
  "192.0.0.0/24",    // IETF protocol assignments
  "192.0.2.0/24",    // documentation (TEST-NET-1)
  "192.88.99.0/24",  // 6to4 relay (deprecated)
  "192.168.0.0/16",  // RFC1918
  "198.18.0.0/15",   // benchmark testing
  "198.51.100.0/24", // documentation (TEST-NET-2)
  "203.0.113.0/24",  // documentation (TEST-NET-3)
  "224.0.0.0/4",     // multicast
  "240.0.0.0/4",     // reserved
  "255.255.255.255/32",
];

/** Parse colon-separated hextets without any "::" expansion. */
function parseHextets(s: string): number[] | null {
  if (s === "") return [];
  const out: number[] = [];
  for (const g of s.split(":")) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out;
}

/**
 * Expand an IPv6 address to exactly 8 hextets. Handles "::" compression,
 * embedded IPv4 tails ("::ffff:1.2.3.4"), and zone ids ("fe80::1%eth0").
 * Returns null when unparseable.
 */
function expandIpv6(ip: string): number[] | null {
  const addr = ip.split("%")[0]!;
  if (addr.includes(".")) {
    // IPv4 tail: the head portion occupies 6 hextets.
    const lastColon = addr.lastIndexOf(":");
    const head = addr.slice(0, lastColon);
    const tail = addr.slice(lastColon + 1);
    const v4 = ipv4ToInt(tail);
    if (v4 === null) return null;
    const head6 = expandHeadTo(head, 6);
    if (head6 === null) return null;
    return [...head6, (v4 >>> 16) & 0xffff, v4 & 0xffff];
  }
  return expandHeadTo(addr, 8);
}

/** Expand the head portion to exactly `size` hextets. Null when invalid. */
function expandHeadTo(head: string, size: number): number[] | null {
  const halves = head.split("::");
  if (halves.length > 2) return null;
  if (halves.length === 1) {
    const g = parseHextets(head);
    return g !== null && g.length === size ? g : null;
  }
  const left = parseHextets(halves[0]!);
  const right = parseHextets(halves[1]!);
  if (left === null || right === null) return null;
  if (left.length + right.length >= size) return null;
  return [...left, ...new Array(size - left.length - right.length).fill(0), ...right];
}

/**
 * True only when the address is a routable public IP. Anything unparseable,
 * non-public, or special-purpose returns false (fail closed).
 */
export function isPublicIpAddress(ip: string): boolean {
  const v4 = ipv4ToInt(ip);
  if (v4 !== null) {
    return !PRIVATE_V4_CIDRS.some((cidr) => inCidrV4(ip, cidr));
  }
  const v6 = expandIpv6(ip);
  if (v6 === null) return false;
  const a = v6[0]!;
  const b = v6[1]!;
  // ::ffff:0:0/96 IPv4-mapped — classify by the embedded IPv4 address
  if (v6[5] === 0xffff && v6.slice(0, 5).every((p) => p === 0)) {
    const h6 = v6[6]!;
    const h7 = v6[7]!;
    const emb = `${(h6 >>> 8) & 0xff}.${h6 & 0xff}.${(h7 >>> 8) & 0xff}.${h7 & 0xff}`;
    return isPublicIpAddress(emb);
  }
  if (v6.every((p) => p === 0)) return false; // ::
  if (v6[7] === 1 && v6.slice(0, 7).every((p) => p === 0)) return false; // ::1 loopback
  if ((a & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((a & 0xfe00) === 0xfc00) return false; // fc00::/7 unique-local
  if ((a & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  if (a === 0x2001 && b === 0x0db8) return false; // 2001:db8::/32 documentation
  if (a === 0x0064 && (b & 0xffc0) === 0xff00) return false; // 64:ff9b::/96 translation
  if (a === 0x2002) return false; // 6to4 2002::/16
  return true;
}

/* ─── URL validation ────────────────────────────────────────────────────── */

export interface ValidatedTarget {
  url: URL;
  hostname: string;
}

/** Structural checks only — no DNS. Throws TargetValidationError. */
export function parseTargetUrl(rawUrl: string): ValidatedTarget {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new TargetValidationError("bad_url", "Target must be a valid absolute URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TargetValidationError("bad_protocol", "Target must use http:// or https://.");
  }
  if (url.username || url.password) {
    throw new TargetValidationError(
      "credentials_in_url",
      "Target URL must not contain credentials.",
    );
  }
  let hostname = url.hostname.toLowerCase();
  if (!hostname) {
    throw new TargetValidationError("empty_hostname", "Target URL must include a hostname.");
  }
  // Node keeps brackets on IPv6 literals ("[::1]"); strip them for classification.
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    hostname = hostname.slice(1, -1);
  }
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (!ALLOWED_TARGET_PORTS.has(port)) {
    throw new TargetValidationError(
      "port_not_allowed",
      `Port ${port} is not allowed for scanning.`,
    );
  }
  return { url, hostname };
}

/* ─── DNS resolution checks ─────────────────────────────────────────────── */

async function lookupAll(hostname: string): Promise<string[]> {
  // Imported dynamically so tests can mock "node:dns" via the static import below.
  const { promises: dns } = await import("node:dns");
  try {
    const records = await dns.lookup(hostname, { all: true });
    return records.map((r) => r.address);
  } catch (err) {
    throw new TargetValidationError(
      "dns_failed",
      `Could not resolve ${hostname}; refusing to scan an unresolvable target.`,
    );
  }
}

/**
 * Resolve the hostname and require every address to be public.
 * IP literals are checked directly. Fails closed on DNS errors.
 */
export async function assertPublicResolution(hostname: string): Promise<string[]> {
  // Tolerate bracketed IPv6 literals ("[::1]") on direct calls.
  const host = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  if (ipv4ToInt(host) !== null || expandIpv6(host) !== null) {
    // Direct IP literal — still subject to the public-IP rule.
    if (!isPublicIpAddress(host)) {
      throw new TargetValidationError(
        "private_ip",
        "Scanning private, loopback, or link-local addresses is not allowed.",
      );
    }
    return [host];
  }
  const addresses = await lookupAll(host);
  const bad = addresses.find((a) => !isPublicIpAddress(a));
  if (bad) {
    throw new TargetValidationError(
      "private_ip",
      `Hostname resolves to a non-public address (${bad}); refusing to scan.`,
    );
  }
  if (addresses.length === 0) {
    throw new TargetValidationError(
      "dns_failed",
      `Could not resolve ${hostname}; refusing to scan an unresolvable target.`,
    );
  }
  return addresses;
}

/** Full check: structure + public DNS resolution. */
export async function assertTargetSafe(rawUrl: string): Promise<ValidatedTarget> {
  const target = parseTargetUrl(rawUrl);
  await assertPublicResolution(target.hostname);
  return target;
}

/* ─── Fetch with per-hop validation ─────────────────────────────────────── */

/**
 * Resolve a redirect `Location` against the current URL and run the full
 * target guard on the result. Exported for testing.
 */
export async function resolveRedirectTarget(current: URL, location: string): Promise<URL> {
  let next: URL;
  try {
    next = new URL(location, current.toString());
  } catch {
    throw new TargetValidationError(
      "redirect_rejected",
      "Redirect target is not a valid URL; refusing to follow.",
    );
  }
  const target = parseTargetUrl(next.toString());
  await assertPublicResolution(target.hostname);
  return target.url;
}

export interface ValidatedFetchOptions {
  maxRedirects?: number;
  timeoutMs?: number;
}

/**
 * fetch() that follows redirects manually and re-runs the target guard on
 * every hop, so a benign initial URL can't bounce the scan onto an internal
 * host. Non-redirect responses are returned as-is.
 */
export async function validatedFetch(
  input: string,
  init: RequestInit = {},
  opts: ValidatedFetchOptions = {},
): Promise<Response> {
  const maxRedirects = opts.maxRedirects ?? MAX_REDIRECTS;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  let current = input;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const target = parseTargetUrl(current);
    await assertPublicResolution(target.hostname);

    let res: Response;
    try {
      res = await fetch(target.url.toString(), {
        ...init,
        redirect: "manual",
        signal: init.signal ?? AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new TargetValidationError(
        "request_failed",
        `Request to ${target.hostname} failed: ${(err as Error).message}`,
      );
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      await res.body?.cancel().catch(() => {});
      if (!location) return res;
      if (hop === maxRedirects) {
        throw new TargetValidationError(
          "too_many_redirects",
          `Redirect chain exceeded ${maxRedirects} hops; refusing to follow.`,
        );
      }
      try {
        current = (await resolveRedirectTarget(target.url, location)).toString();
      } catch (err) {
        if (err instanceof TargetValidationError) throw err;
        throw new TargetValidationError(
          "redirect_rejected",
          "Redirect target is not a valid URL; refusing to follow.",
        );
      }
      continue;
    }
    return res;
  }
  throw new TargetValidationError(
    "too_many_redirects",
    `Redirect chain exceeded ${maxRedirects} hops; refusing to follow.`,
  );
}
