/**
 * HostSet — one parsed set of domains, IPs and CIDRs, with the matching
 * rules of zimzilla/scope.py's HostSet: a hostname matches a listed
 * domain exactly or as a subdomain of it; an IP matches a listed IP
 * exactly or any CIDR that contains it (address family must match).
 * Membership is polarity-neutral — the caller decides what a match
 * means for its list, which is what stops the allow and deny lists from
 * silently inverting each other. Loopback/localhost is infrastructure,
 * never a target: it is never a member of any set.
 */
import { parseIp, parseNetwork, networkContains, IPV4_RE, IPV4_CIDR_RE, type ParsedNetwork } from "./scope-ip.js";
// ---------------------------------------------------------------------------
// HostSet — one parsed set of domains, IPs and CIDRs (port of scope.py)
// ---------------------------------------------------------------------------

/** YAML keys the Python `HostSet.from_mapping` accepts, by entry kind. */
const DOMAIN_KEYS = ["domain", "domains", "in_scope"] as const;
const IP_KEYS = ["ip", "ips", "hosts"] as const;
const CIDR_KEYS = ["cidr", "cidrs", "networks"] as const;


/** Hosts that are always infrastructure, never targets (Python: reason "local"). */
export const LOCAL_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

/** Membership verdict: whether the host is in the set, and why. */
export interface HostMembership {
  member: boolean;
  reason: string;
}

/**
 * Classify one raw scope entry the way the Python scope-validator's
 * `_classify` does: URLs classify by their host; anything that is not a
 * domain, wildcard, IP or CIDR is "other" and never enters a set.
 *
 * @param asset - The raw entry as written by the operator.
 * @returns "domain" | "wildcard" | "ip" | "cidr" | "other".
 */
export function classifyScopeEntry(asset: string): "domain" | "wildcard" | "ip" | "cidr" | "other" {
  let a = asset.trim().toLowerCase();
  if (a.includes("://")) {
    try {
      a = new URL(a).hostname ?? "";
    } catch {
      a = a.split("://")[1]?.split("/")[0]?.split(":")[0] ?? "";
    }
  }
  if (!a) return "other";
  if (a.includes("/")) {
    if (parseNetwork(a)) return "cidr";
    a = a.split("/")[0];
  }
  if (parseIp(a.replace(/^\[/, "").replace(/\]$/, ""))) return "ip";
  const host = a.replace(/^\*\./, "").split(":")[0].replace(/\.+$/, "");
  if (IPV4_RE.test(host)) return "other"; // address-shaped but not a valid address
  if (a.startsWith("*.")) return HOSTNAME_LABELS_RE.test(host) ? "wildcard" : "other";
  return HOSTNAME_LABELS_RE.test(host) ? "domain" : "other";
}

const HOSTNAME_LABELS_RE = /^(?!-)[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})+$/;

/** A parsed set of domains, IPs and CIDRs, with the Python matching rules. */
export class HostSet {
  readonly domains: Set<string> = new Set();
  readonly ips: Set<string> = new Set();
  readonly cidrs: ParsedNetwork[] = [];

  /**
   * Build a set from a mapping with the Python key spellings (domain(s)/
   * in_scope, ip(s)/hosts, cidr(s)/networks). Mirrors
   * `HostSet.from_mapping`: ip-key entries that look like CIDRs become
   * networks, IPv4-shaped entries become IPs, anything else is normalised
   * as a domain.
   *
   * @param data - The parsed scope-file mapping.
   * @returns The populated set (empty for a non-mapping input).
   */
  static fromMapping(data: Record<string, unknown>): HostSet {
    const hs = new HostSet();
    const collect = (value: unknown): string[] => {
      if (value === null || value === undefined) return [];
      if (typeof value === "string") return [value];
      if (Array.isArray(value)) return value.map((v) => String(v));
      return [];
    };
    for (const key of DOMAIN_KEYS) {
      for (const entry of collect(data[key])) {
        const host = HostSet.normaliseHost(entry);
        if (host) hs.domains.add(host);
      }
    }
    for (const key of IP_KEYS) {
      for (const raw of collect(data[key])) {
        const entry = raw.trim();
        if (IPV4_CIDR_RE.test(entry) || (entry.includes(":") && entry.includes("/"))) {
          const net = parseNetwork(entry);
          if (net) {
            hs.cidrs.push(net);
            continue;
          }
        }
        if (IPV4_RE.test(entry)) {
          hs.ips.add(entry);
        } else {
          const host = HostSet.normaliseHost(entry);
          if (host) hs.domains.add(host);
        }
      }
    }
    for (const key of CIDR_KEYS) {
      for (const entry of collect(data[key])) {
        const net = parseNetwork(entry.trim());
        if (net) hs.cidrs.push(net);
      }
    }
    return hs;
  }

  /**
   * Build a set from the runner's flat entry lists (--scope /
   * --out-of-scope values, ROE JSON arrays). Each entry is classified with
   * {@link classifyScopeEntry}; "other" entries are skipped and reported.
   *
   * @param entries - Raw entries as written by the operator.
   * @returns The populated set plus the entries that could not be placed.
   */
  static fromEntries(entries: readonly string[]): { set: HostSet; skipped: string[] } {
    const set = new HostSet();
    const skipped: string[] = [];
    for (const raw of entries) {
      const kind = classifyScopeEntry(raw);
      const entry = raw.trim();
      if (kind === "ip") {
        const ip = parseIp(entry.replace(/^\[/, "").replace(/\]$/, ""));
        if (ip) set.ips.add(ip.text);
        else skipped.push(raw);
      } else if (kind === "cidr") {
        const net = parseNetwork(entry);
        if (net) set.cidrs.push(net);
        else skipped.push(raw);
      } else if (kind === "domain" || kind === "wildcard") {
        const host = HostSet.normaliseHost(entry);
        if (host) set.domains.add(host);
        else skipped.push(raw);
      } else {
        skipped.push(raw);
      }
    }
    return { set, skipped };
  }

  /**
   * Normalise one entry to a bare hostname (Python `_normalise_host`):
   * strip scheme, path, port, wildcard prefix and surrounding dots.
   *
   * @param entry - The raw entry.
   * @returns The normalised hostname, or "" when nothing remains.
   */
  static normaliseHost(entry: string): string {
    let e = entry.trim().toLowerCase();
    if (!e) return "";
    e = e.split("://").pop() ?? "";
    e = e.split("/")[0];
    e = e.split(":")[0];
    e = e.replace(/^[*.]+/, "").replace(/[*.]+$/, "");
    e = e.replace(/^\.+/, "").replace(/\.+$/, "");
    return e;
  }

  /** True when the set holds no domains, IPs or CIDRs. */
  get empty(): boolean {
    return this.domains.size === 0 && this.ips.size === 0 && this.cidrs.length === 0;
  }

  /** Total entry count across domains, IPs and CIDRs. */
  get size(): number {
    return this.domains.size + this.ips.size + this.cidrs.length;
  }

  /**
   * Membership test, polarity-neutral (Python `HostSet.contains`): the
   * caller decides what a match means for its list. Loopback/localhost is
   * never a member of any set. Hostnames match exactly or as a subdomain
   * of a listed domain; IPs match exactly or by CIDR containment.
   *
   * @param host - The host or IP to test (case-insensitive; trailing root
   *   dot and IPv6 brackets are stripped).
   * @returns Whether the host is a member, with the matching rule as reason.
   */
  contains(host: string): HostMembership {
    const h = host.trim().toLowerCase().replace(/^\[+/, "").replace(/\]+$/, "").replace(/\.+$/, "");
    if (!h) return { member: false, reason: "empty" };
    if (LOCAL_HOSTS.has(h)) return { member: false, reason: "local" };

    const ip = parseIp(h);
    if (ip) {
      if (this.ips.has(ip.text)) return { member: true, reason: "listed ip" };
      for (const net of this.cidrs) {
        if (networkContains(net, ip)) return { member: true, reason: `in ${net.text}` };
      }
      return { member: false, reason: "ip not listed" };
    }

    if (this.domains.has(h)) return { member: true, reason: "listed domain" };
    for (const dom of this.domains) {
      if (h === dom || h.endsWith(`.${dom}`)) return { member: true, reason: `subdomain of ${dom}` };
    }
    return { member: false, reason: "host not listed" };
  }

  /**
   * One-line description of the set (Python `HostSet.describe`).
   *
   * @returns "empty", or a count summary like "5 entries (3d/1i/1n)".
   */
  describe(): string {
    if (this.empty) return "empty";
    return `${this.size} entries (${this.domains.size}d/${this.ips.size}i/${this.cidrs.length}n)`;
  }
}
