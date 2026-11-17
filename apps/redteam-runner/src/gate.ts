/**
 * Engagement-level gating. Every check fails closed: uncertainty → deny.
 *
 * Layers (all must pass before aggressive work):
 *  1. Ownership verification: domain ownership proven by the in-app DNS TXT
 *     challenge recorded in the local verified-domain store, or an explicit
 *     operator attestation when supplied by the caller. No external service.
 *  2. Scope: every probed/scanned URL's hostname must be an exact in-scope host.
 *  3. Technique exclusions: always-excluded + mode defaults + ROE exclusions.
 *  4. Blackout windows: the runner pauses, it does not skip.
 *  5. Test window: the runner refuses to run outside the agreed window.
 */

import { isIP } from "node:net";
import {
  extractDomain,
  defaultVerificationStoreFile,
  type StoreDoc,
} from "@secscan/redteam-auth-gate";
import { readFile } from "node:fs/promises";
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
      // Unparseable scope entry - fail closed downstream by matching nothing.
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
  // apply - the always-excluded set (T1499) and the mode defaults are
  // bypassed for testing. The bypass is engagement-level and recorded by
  // the authorize phase's test_mode_active event.
  if (opts?.testMode) {
    const roeOnly = (roe.excludedTechniques ?? []).map((t) => t.toUpperCase());
    return !roeOnly.includes(attackId.toUpperCase());
  }
  const excluded = resolveExcludedTechniques(mode, roe.excludedTechniques);
  return !excluded.includes(attackId.toUpperCase());
}

export interface CheckAuthorizationOptions {
  /**
   * Explicit operator attestation recorded on the engagement. When provided it
   * is accepted as the verification basis without consulting the local DNS
   * challenge store. Use for test/sandbox flows that intentionally bypass DNS.
   */
  attestedProof?: string;
  /**
   * LOCAL SANDBOX MODE ONLY. When true, skips DNS/store ownership proof for a
   * target that itself resolves to a private/loopback host (e.g. localhost,
   * 127.0.0.1, RFC1918). For any non-private domain this flag has no effect.
   */
  allowLocalSandbox?: boolean;
  /** Path to the local verified-domains store. Defaults to the app store. */
  storeFile?: string;
}

function normalizeDomainKey(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.$/, "");
}

async function isLocallyVerified(domain: string, storeFile?: string): Promise<boolean> {
  const file = storeFile ?? defaultVerificationStoreFile();
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoreDoc> | null;
    if (!parsed || typeof parsed !== "object") return false;
    const verified = (parsed as { verified?: unknown }).verified;
    if (!verified || typeof verified !== "object") return false;
    return normalizeDomainKey(domain) in (verified as Record<string, unknown>);
  } catch {
    return false;
  }
}

/**
 * Authorization gate. Fail closed: only an explicit attestation, local-sandbox
 * private target, or a domain recorded as verified in the app-local DNS TXT
 * store is allowed. No external service is consulted.
 */
export async function checkAuthorization(
  domain: string,
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
        `LOCAL SANDBOX MODE: ${target} is a private/loopback target - ownership ` +
        `verification was skipped (no DNS TXT proof is possible for a loopback address). ` +
        `This bypass never applies to a non-private domain.`,
    };
  }
  if (opts.attestedProof) {
    return { allowed: true, reason: opts.attestedProof };
  }
  const verified = await isLocallyVerified(target, opts.storeFile);
  if (!verified) {
    return {
      allowed: false,
      reason:
        `domain ${target} is not ownership-verified in the local app store. ` +
        `Run verify_domain_start for ${target}, publish the TXT record at ` +
        `_secscan-challenge.${target}, then run verify_domain_check. Both red and black ` +
        `modes require this proof - covert means covert vs the blue team, never vs the authorization gate.`,
    };
  }
  return { allowed: true, reason: `${target} is verified in the local app store (DNS TXT challenge).` };
}

export interface ScopeAuthorizationOptions {
  /**
   * Explicit operator attestation covering declared in-scope hosts. When set,
   * public domains in scope are accepted on that attestation basis.
   */
  attestedProof?: string;
  /**
   * LOCAL SANDBOX MODE ONLY. When true, every host in scope must be
   * private/loopback so a loopback target can never combine with public scope.
   */
  allowLocalSandbox?: boolean;
  /** The engagement target, already verified by {@link checkAuthorization}. */
  verifiedTarget?: string;
  /** Path to the local verified-domains store. Defaults to the app store. */
  storeFile?: string;
}

/**
 * Verify ownership for EVERY host the engagement may touch. Fail closed.
 * - empty scope: denied
 * - local sandbox: every host must be private/loopback
 * - otherwise: target needs no second check; IP-literal entries are ROE-authorized
 *   host-engagement targets; every other domain must be locally verified (DNS TXT
 *   store) unless covered by an explicit attestation.
 */
export async function checkScopeAuthorization(
  hosts: readonly string[],
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
            `too. Remove ${host} from scope, or verify it locally and run without local sandbox.`,
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
    // IP-literal scope entry: authorized by ROE/credentials; DNS verification N/A.
    if (isIP(host) !== 0) continue;
    if (opts.attestedProof) continue;
    const verified = await isLocallyVerified(host, opts.storeFile);
    if (!verified) {
      return {
        allowed: false,
        reason:
          `scope host ${host} is not ownership-verified in the local app store. Every domain in scope ` +
          `must be verified on its own: verify_domain_start for ${host}, publish the TXT record, ` +
          `then verify_domain_check. Listing a host in scope never substitutes for proving it.`,
      };
    }
  }
  return { allowed: true };
}
