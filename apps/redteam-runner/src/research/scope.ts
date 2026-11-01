/**
 * The deep-research skill's scope law, mechanized for the research
 * tools.
 *
 * The law (fleet skill deep-research-osint): general technology
 * research — a CVE, a product, a technique — is unbounded; the
 * perimeter binds TARGETS. Target-directed research is bounded to the
 * verified engagement record, and an out-of-scope subject gets zero
 * lookups and a logged SCOPE-EXIT.
 *
 * The mechanical line this module draws (stated exactly, because the
 * handler enforces it): a research call is TARGET-DIRECTED about a
 * host when the call names that host (a fetch URL's host, or a host/IP
 * token inside a search query) AND the host is tied to the engagement
 * record — it is on the operator's out-of-scope deny list, or it
 * belongs to the target family: it equals a scope host, is a
 * sub/superdomain of one, shares a registrable domain with one, or is
 * an IP inside a scope CIDR. A target-directed call passes only when
 * the engagement's own ScopeGuard allows the host (deny beats allow,
 * the record's attested scope governs — scopeGuardFor); otherwise it
 * is denied before any lookup happens. A named host with no tie to the
 * record is general research and passes: CVE databases, vendor docs,
 * and write-ups live on hosts the record never names, and the record
 * holds hosts, not organization names — a query naming no host token
 * is general by construction. Known limit of the line: a target listed
 * by IP cannot be tied to its hostname without DNS, so the hostname
 * form is general unless the deny list or a domain entry ties it.
 *
 * One mechanism the classifier must compensate for: the shared
 * HostSet short-circuits the four local literals (localhost,
 * 127.0.0.1, ::1, 0.0.0.0) out of every set before membership is
 * consulted, so a deny entry naming one of them can never bind
 * through the guard's denyMembership. For exactly that verdict the
 * classifier re-checks the raw deny entries itself (see
 * denyEntryNamesHost) — deny still decides; the shared HostSet keeps
 * the probe semantics it is load-bearing for elsewhere.
 */
import { classifyScopeEntry, scopeGuardFor, type ScopeGuard } from "../safety/scope-guard.js";
import { networkContains, parseIp, parseNetwork } from "../safety/scope-ip.js";

/** The classification of one named host for a research call. */
export type ResearchScopeVerdict =
  | { kind: "general" }
  | { kind: "in-scope" }
  | { kind: "denied"; reason: string };

/** The minimal context the classifier reads (the dispatch Ctx satisfies it). */
export interface ResearchScopeCtx {
  scopeGuard?: ScopeGuard;
  /** Cache key of the record stamp the cached guard was built from (scopeGuardFor). */
  scopeGuardRecordKey?: string;
  verifiedScope?: readonly string[];
  input?: { roe?: { scope?: readonly string[]; outOfScope?: readonly string[] } };
}

const FILE_EXT_TLDS = new Set([
  "html", "htm", "json", "xml", "txt", "md", "js", "ts", "mjs", "java", "class",
  "py", "rb", "php", "asp", "aspx", "jsp", "cgi", "pdf", "png", "jpg", "css",
]);

const SECOND_LEVEL_SUFFIXES = new Set(["co", "com", "net", "org", "ac", "gov", "edu", "or", "ne"]);

/** Normalize a host or scope entry to a bare lowercase hostname/IP (no scheme, port, path, or wildcard marker). */
export function normaliseResearchHost(raw: string): string {
  let h = raw.trim().toLowerCase();
  if (h.startsWith("*.")) h = h.slice(2);
  try {
    if (/^https?:\/\//.test(h)) return new URL(h).hostname.replace(/\.+$/, "");
  } catch {
    /* not a URL — fall through to manual stripping */
  }
  h = h.split("/")[0].split("?")[0];
  if (h.includes("@")) h = h.slice(h.lastIndexOf("@") + 1);
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    if (end > 0) return h.slice(1, end);
  }
  // A bare IP literal normalizes to its canonical parsed form. Without
  // this, the port strip below mangles bare IPv6 (its segments are not
  // a trailing numeric port): "::1" came out as ":" and could never
  // match the deny list, the scope entries, or LOCAL_HOSTS downstream.
  const bareIp = parseIp(h.replace(/^\[+/, "").replace(/\]+$/, ""));
  if (bareIp) return bareIp.text;
  const colon = h.lastIndexOf(":");
  if (colon > 0 && /^\d+$/.test(h.slice(colon + 1))) h = h.slice(0, colon);
  return h.replace(/\.+$/, "");
}

/** The registrable domain (eTLD+1 approximation) for a hostname; undefined for IPs and single labels. */
export function registrableDomain(host: string): string | undefined {
  if (parseIp(host)) return undefined;
  const labels = host.split(".").filter(Boolean);
  if (labels.length < 2) return undefined;
  const last = labels[labels.length - 1];
  const second = labels[labels.length - 2];
  if (last.length === 2 && SECOND_LEVEL_SUFFIXES.has(second) && labels.length >= 3) {
    return labels.slice(-3).join(".");
  }
  return labels.slice(-2).join(".");
}

interface ScopeEntryHost {
  raw: string;
  host: string;
  kind: string;
}

/** True when two hosts belong to the same target family (see module header for the exact rule). */
export function hostsRelated(host: string, entry: ScopeEntryHost): boolean {
  const hostIp = parseIp(host);
  const entryIp = parseIp(entry.host);
  if (hostIp || entryIp || entry.kind === "cidr" || entry.kind === "ip") {
    if (hostIp && entry.kind === "cidr") {
      const net = parseNetwork(entry.raw.trim());
      return net ? networkContains(net, hostIp) : false;
    }
    if (hostIp && entryIp) return hostIp.value === entryIp.value;
    return host === entry.host;
  }
  if (host === entry.host) return true;
  if (host.endsWith(`.${entry.host}`) || entry.host.endsWith(`.${host}`)) return true;
  const a = registrableDomain(host);
  const b = registrableDomain(entry.host);
  return a !== undefined && a === b;
}

/**
 * Extract the hosts a search query names: URL hosts (bracketed-IPv6
 * ones included), IPv4 literals, dotted hostname tokens (file-name
 * lookalikes excluded), and the bare local-literal tokens — the word
 * "localhost" and IPv6 literals — that none of those forms can see.
 *
 * @param query - The raw query text.
 * @returns The distinct normalized hosts, in first-appearance order.
 */
export function extractQueryHosts(query: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (h: string): void => {
    const n = normaliseResearchHost(h);
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  };
  // Bracketed-IPv6 URL hosts first: the general URL pass below stops
  // its match at "]", which truncates http://[::1]:8080/x before URL
  // can parse it, so a bracketed host would never surface.
  for (const m of query.matchAll(/https?:\/\/\[[0-9a-fA-F:.]+\](?::\d+)?(?:\/[^\s"'<>)\]]*)?/gi)) {
    try {
      push(new URL(m[0]).hostname);
    } catch {
      /* malformed URL text in a query is text, not a host */
    }
  }
  for (const m of query.matchAll(/https?:\/\/[^\s"'<>)\]]+/gi)) {
    try {
      push(new URL(m[0]).hostname);
    } catch {
      /* malformed URL text in a query is text, not a host */
    }
  }
  for (const m of query.matchAll(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g)) {
    if (parseIp(m[0])) push(m[0]);
  }
  for (const m of query.matchAll(/\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}\b/gi)) {
    const token = m[0].toLowerCase();
    const tld = token.slice(token.lastIndexOf(".") + 1);
    if (FILE_EXT_TLDS.has(tld)) continue;
    push(token);
  }
  // Bare tokens the passes above cannot see: "localhost" is an
  // undotted single label (the hostname pass requires a dot) and an
  // IPv6 literal's colons fit no pass above. A punctuation-delimited
  // word is pushed only when it normalizes to "localhost" or parses
  // as an IPv6 literal, so times ("12:30"), ratios ("a:b"), and
  // ordinary words stay text.
  for (const m of query.matchAll(/[^\s"'<>(),;]+/g)) {
    const n = normaliseResearchHost(m[0]);
    if (n === "localhost" || (n.includes(":") && parseIp(n))) push(n);
  }
  return out;
}

/** The scope entries' hosts, from the attested record when present, else the launch ROE. */
function scopeEntryHosts(ctx: ResearchScopeCtx): ScopeEntryHost[] {
  const entries = ctx.verifiedScope && ctx.verifiedScope.length > 0 ? ctx.verifiedScope : (ctx.input?.roe?.scope ?? []);
  return entries.map((e) => ({ raw: e, host: normaliseResearchHost(e), kind: classifyScopeEntry(e) }));
}

/**
 * True when a raw out-of-scope entry names `host`: an exact match
 * after normalization, or — for an IP host — a CIDR entry containing
 * it. Consulted only for the local literals, whose HostSet verdict is
 * the "local" short-circuit rather than a membership answer (see
 * module header). The entries read are the same ROE deny list the
 * guard itself was built from (scopeGuardFor sources deny there in
 * both its record and launch paths), so this decides from exactly the
 * operator's list — never a second one.
 *
 * @param ctx - The engagement context (reads the ROE deny list).
 * @param host - The normalized host to test.
 * @returns Whether a deny entry names the host.
 */
function denyEntryNamesHost(ctx: ResearchScopeCtx, host: string): boolean {
  const hostIp = parseIp(host);
  for (const raw of ctx.input?.roe?.outOfScope ?? []) {
    if (normaliseResearchHost(raw) === host) return true;
    if (hostIp && classifyScopeEntry(raw) === "cidr") {
      const net = parseNetwork(raw.trim());
      if (net && networkContains(net, hostIp)) return true;
    }
  }
  return false;
}

/**
 * Classify one named host for a research call (see module header).
 *
 * @param ctx - The engagement context (record + ROE + guard).
 * @param host - The named host (any form; normalized here).
 * @returns The verdict: general / in-scope / denied with the deciding rule.
 */
export function classifyResearchHost(ctx: ResearchScopeCtx, host: string): ResearchScopeVerdict {
  const h = normaliseResearchHost(host);
  if (!h) return { kind: "general" };
  const guard = scopeGuardFor(ctx);
  const denied = guard.denyMembership(h);
  if (denied.member) {
    return {
      kind: "denied",
      reason: `${h} is on the engagement out-of-scope list (${denied.reason}) — deny beats allow, for research as for probes`,
    };
  }
  // The HostSet "local" short-circuit (see module header): the deny
  // verdict for a local literal is {member:false, reason:"local"}
  // whether or not an entry names it, so the literal case is decided
  // against the raw deny entries here.
  if (denied.reason === "local" && denyEntryNamesHost(ctx, h)) {
    return {
      kind: "denied",
      reason: `${h} is on the engagement out-of-scope list (listed local host) — deny beats allow, for research as for probes`,
    };
  }
  const related = scopeEntryHosts(ctx).some((e) => hostsRelated(h, e));
  if (!related) return { kind: "general" };
  const verdict = guard.checkHost(h);
  return verdict.allowed ? { kind: "in-scope" } : { kind: "denied", reason: verdict.reason };
}

/**
 * Classify every host a research call names; the first denial decides.
 *
 * @param ctx - The engagement context.
 * @param hosts - The hosts the call names.
 * @returns The denied host + reason, or undefined when the call may proceed.
 */
export function researchScopeDenial(
  ctx: ResearchScopeCtx,
  hosts: readonly string[],
): { host: string; reason: string } | undefined {
  for (const host of hosts) {
    const v = classifyResearchHost(ctx, host);
    if (v.kind === "denied") return { host: normaliseResearchHost(host), reason: v.reason };
  }
  return undefined;
}
