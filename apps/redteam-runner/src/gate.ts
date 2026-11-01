/**
 * Engagement-level gating. Every check fails closed: uncertainty → deny.
 *
 * Layers (all must pass before aggressive work):
 *  1. Ownership verification: by default the engagement record's operator
 *     attestation; server-authoritative (auth-gate's isServerVerified)
 *     only when the operator opts into service verification.
 *  2. Scope: every probed/scanned URL's hostname must be an exact in-scope host.
 *  3. Technique exclusions: always-excluded + mode defaults + ROE exclusions.
 *  4. Blackout windows: the runner pauses, it does not skip.
 *  5. Test window: the runner refuses to run outside the agreed window.
 */

import { isIP } from "node:net";
import { isServerVerified as authGateIsServerVerified } from "@secscan/redteam-auth-gate";
import { extractDomain } from "@secscan/redteam-auth-gate";
import { resolveExcludedTechniques } from "./attack.js";
import { isPrivateOrLoopbackHost } from "./prober.js";
import type { BlackoutWindow, EngagementMode, RulesOfEngagement } from "./types.js";

export interface GateVerdict {
  allowed: boolean;
  reason?: string;
}

/** Normalize ROE scope entries (URLs or bare hosts) to lowercase hostnames. */
export function scopeHosts(roe: RulesOfEngagement): string[] {
  const hosts: string[] = [];
  for (const entry of roe.scope) {
    try {
      hosts.push(extractDomain(entry));
    } catch {
      // Unparseable scope entry — fail closed downstream by matching nothing.
    }
  }
  return [...new Set(hosts)];
}

/** True when the URL's hostname is exactly one of the in-scope hosts. */
export function urlInScope(url: string, hosts: string[]): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return hosts.includes(host);
  } catch {
    return false;
  }
}

/**
 * True when `now` falls inside any blackout window. Windows are daily,
 * "HH:MM" 24h, and may cross midnight. Evaluated in the window's tz (or the
 * runner's local tz when unset).
 */
export function inBlackout(now: Date, windows: BlackoutWindow[] | undefined): BlackoutWindow | null {
  if (!windows || windows.length === 0) return null;
  for (const w of windows) {
    const tz = w.tz;
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .format(now)
      .split(":");
    const cur = Number(parts[0]) * 60 + Number(parts[1]);
    const [sh, sm] = w.start.split(":").map(Number);
    const [eh, em] = w.end.split(":").map(Number);
    if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) continue; // malformed → ignore window, never block on garbage
    const start = sh * 60 + sm;
    const end = eh * 60 + em;
    const inside = start <= end ? cur >= start && cur < end : cur >= start || cur < end;
    if (inside) return w;
  }
  return null;
}

/** True when `now` is inside the agreed test window (or no window was set). */
export function inTestWindow(now: Date, roe: RulesOfEngagement): boolean {
  if (!roe.testWindow) return true;
  const t = now.getTime();
  return t >= Date.parse(roe.testWindow.start) && t <= Date.parse(roe.testWindow.end);
}

/** True when the ATT&CK technique may be used in this engagement. */
export function techniqueAllowed(
  attackId: string | undefined,
  mode: EngagementMode,
  roe: RulesOfEngagement,
  opts?: { testMode?: boolean },
): boolean {
  if (!attackId) return true; // unmapped actions are allowed; the mapping is advisory
  // TEST MODE (operator order): only the operator's own ROE exclusions
  // apply — the always-excluded set (T1499) and the mode defaults are
  // bypassed for testing. The bypass is engagement-level and recorded by
  // the authorize phase's test_mode_active event.
  if (opts?.testMode) {
    const roeOnly = (roe.excludedTechniques ?? []).map((t) => t.toUpperCase());
    return !roeOnly.includes(attackId.toUpperCase());
  }
  const excluded = resolveExcludedTechniques(mode, roe.excludedTechniques);
  return !excluded.includes(attackId.toUpperCase());
}

export interface ServerGateConfig {
  mcpEndpoint: string;
  mcpToken: string;
}

export interface CheckAuthorizationOptions {
  /**
   * The engagement record's ownership attestation (operator attestation /
   * proofMethod text), when verification is taken from the record — the
   * default basis. When set, the gate returns it as the verdict reason and
   * the server check is never consulted. Unset means the caller opted into
   * service verification and the server check decides.
   */
  attestedProof?: string;
  /**
   * LOCAL SANDBOX MODE ONLY. When true, skips the server verification call
   * — but ONLY when `domain` itself resolves to a private/loopback host
   * (e.g. localhost, 127.0.0.1, a RFC1918 address). For any real-looking
   * domain this flag has zero effect: the server check still runs and the
   * engagement still fails closed exactly as before. This exists so a
   * locally-hosted sandbox target (Juice Shop/DVWA on 127.0.0.1) can be
   * engaged without needing DNS TXT ownership proof, which can't exist for
   * a loopback address anyway. Default false; must be explicitly opted
   * into (CLI --local-sandbox / REDTEAM_LOCAL_SANDBOX=1), never implied.
   */
  allowLocalSandbox?: boolean;
}

/**
 * The authorization gate. Default basis: the engagement record's operator
 * attestation (opts.attestedProof) — allowed, with the attestation as the
 * recorded proof, and no service call. When no attestation is supplied the
 * caller opted into service verification: the SecScan server must positively
 * list the domain as verified, and network errors, timeouts, missing
 * token → denied (fail closed).
 * `verify` is injectable so unit tests never touch the network.
 */
export async function checkAuthorization(
  domain: string,
  cfg: ServerGateConfig,
  verify: (
    domain: string,
    cfg: { endpoint: string; token: string },
  ) => Promise<boolean> = (d, c) => authGateIsServerVerified(d, c),
  opts: CheckAuthorizationOptions = {},
): Promise<GateVerdict> {
  let target: string;
  try {
    target = extractDomain(domain);
  } catch {
    return { allowed: false, reason: `unparseable target: ${domain}` };
  }
  if (opts.allowLocalSandbox && isPrivateOrLoopbackHost(target)) {
    return {
      allowed: true,
      reason:
        `LOCAL SANDBOX MODE: ${target} is a private/loopback target — server ownership ` +
        `verification was skipped (no DNS TXT proof is possible for a loopback address). ` +
        `This bypass never applies to a non-private domain.`,
    };
  }
  if (opts.attestedProof) {
    return { allowed: true, reason: opts.attestedProof };
  }
  let verified = false;
  try {
    verified = await verify(target, { endpoint: cfg.mcpEndpoint, token: cfg.mcpToken });
  } catch {
    verified = false;
  }
  if (!verified) {
    return {
      allowed: false,
      reason:
        `domain ${target} is not ownership-verified (server check). ` +
        `Publish the SecScan challenge (start_domain_verification → TXT at ` +
        `_secscan-challenge.${target}) and re-run. Both red and black modes ` +
        `require this proof — covert means covert vs the blue team, never vs ` +
        `the authorization gate.`,
    };
  }
  return { allowed: true };
}

export interface ScopeAuthorizationOptions {
  /**
   * The engagement record's ownership attestation, as in
   * {@link CheckAuthorizationOptions.attestedProof}: when set, an in-scope
   * public host is covered by the attestation and the server check is never
   * consulted for it. The structural rules below (empty scope, private
   * hosts, sandbox containment) apply unchanged under either basis.
   */
  attestedProof?: string;
  /**
   * LOCAL SANDBOX MODE ONLY. When true, the whole engagement is restricted to
   * private/loopback hosts: every scope entry must be private too, because a
   * sandbox bypass for the target says nothing about ownership of anything else.
   */
  allowLocalSandbox?: boolean;
  /** The engagement target, already verified by {@link checkAuthorization}. */
  verifiedTarget?: string;
}

/**
 * Verify ownership for EVERY host the engagement may touch, not just its target.
 *
 * Members of the ROE scope list are checked for exact-hostname membership by the
 * prober, but membership only proves the operator listed them — it does not prove
 * the client owns them. Without this pass, an engagement against one verified
 * domain could probe any number of other public hosts, which is precisely the
 * authorization the product claims to enforce.
 *
 * Rules, all fail closed:
 *  - empty scope: denied (there is nothing an engagement may legitimately probe);
 *  - local sandbox: every host must be private/loopback, so a loopback target can
 *    never be combined with a public host in scope;
 *  - otherwise: the target needs no second call; an IP-literal scope entry is a
 *    host-engagement target authorized by the ROE (domain verification cannot
 *    apply to an address); every other host must be verified — by the
 *    engagement record's attestation on the default basis, or server-verified
 *    when the operator opted into service verification.
 *
 * `verify` is injectable so unit tests never touch the network.
 */
export async function checkScopeAuthorization(
  hosts: readonly string[],
  cfg: ServerGateConfig,
  verify: (
    domain: string,
    cfg: { endpoint: string; token: string },
  ) => Promise<boolean> = (d, c) => authGateIsServerVerified(d, c),
  opts: ScopeAuthorizationOptions = {},
): Promise<GateVerdict> {
  const unique = [...new Set(hosts.map((h) => h.trim().toLowerCase()).filter((h) => h !== ""))];
  if (unique.length === 0) {
    return { allowed: false, reason: "engagement scope is empty: declare at least one in-scope host" };
  }
  let target = "";
  if (opts.verifiedTarget !== undefined) {
    try {
      target = extractDomain(opts.verifiedTarget);
    } catch {
      target = "";
    }
  }
  for (const host of unique) {
    if (opts.allowLocalSandbox) {
      if (!isPrivateOrLoopbackHost(host)) {
        return {
          allowed: false,
          reason:
            `LOCAL SANDBOX MODE cannot cover scope host ${host}: sandbox mode skips ownership ` +
            `verification for a private/loopback target, so every host in scope must be private ` +
            `too. Remove ${host} from scope, or verify it as a domain and run without local sandbox.`,
        };
      }
      continue;
    }
    if (host === target) continue;
    if (isPrivateOrLoopbackHost(host)) {
      return {
        allowed: false,
        reason:
          `scope host ${host} is private/loopback and cannot be ownership-verified. ` +
          `Private and loopback targets are only reachable in local sandbox mode ` +
          `(--local-sandbox or REDTEAM_LOCAL_SANDBOX=1), which is an operator decision ` +
          `and is never implied by the engagement request.`,
      };
    }
    // An IP-literal scope entry is a host-engagement target: the client authorizes it
    // through the ROE and credentials, and domain verification cannot apply to an address.
    if (isIP(host) !== 0) continue;
    // Record basis: the operator's attestation covers every host they
    // declared in scope; no server call is made for it.
    if (opts.attestedProof) continue;
    let verified = false;
    try {
      verified = await verify(host, { endpoint: cfg.mcpEndpoint, token: cfg.mcpToken });
    } catch {
      verified = false;
    }
    if (!verified) {
      return {
        allowed: false,
        reason:
          `scope host ${host} is not ownership-verified (server check). Every domain in scope ` +
          `must be verified on its own: start_domain_verification for ${host}, publish the TXT ` +
          `record, then re-run. Listing a host in scope never substitutes for proving it.`,
      };
    }
  }
  return { allowed: true };
}
