/**
 * Vibe-stack database security probes.
 *
 * Detects Supabase and Firebase backends from the page's JavaScript bundle,
 * then actively tests their database/storage security configuration via their
 * public REST APIs — no repository access required.
 *
 * Key vulnerability class: CVE-2025-48757 (CVSS 9.3) — 10.3% of Lovable-built
 * apps shipped with Supabase tables readable by unauthenticated requests using
 * the public anon key. The anon key is always in client-side JavaScript by
 * design; missing RLS policies are the actual vulnerability.
 *
 * Runs on both Basic and Deep tiers (no extra cost — just a handful of API
 * calls per detected backend).
 *
 * ── WRITE PROBE SAFETY ───────────────────────────────────────────────────────
 * Read tests (SELECT) are entirely non-destructive.
 *
 * Write probes (INSERT) send a body of {"__vibescan_probe__":true}.
 * This field name does not exist in any real schema, so:
 *   - 401 / 403  → auth required before schema check  → PROTECTED
 *   - 400 / 422  → auth passed, schema rejected unknown column → VULNERABLE
 *     (no row is created — PostgREST rejects the insert at schema validation)
 *   - 201        → table has zero schema constraints at all → VULNERABLE
 *     (in this case we immediately DELETE the test row by its returned id)
 *
 * We never send PATCH or DELETE against existing rows. We never use id=eq.0
 * or any heuristic that "probably matches nothing."
 *
 * Write probes are gated behind the Deep tier — Basic tier performs read
 * and informational checks only.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { ScanVulnerability } from "./scanner";
import { runSupabaseProbes } from "./supabase-probes";
import { runFirebaseProbes } from "./firebase-probes";


// ─────────────────────────────────────────────────────────────────────────────
// ORCHESTRATOR
// ─────────────────────────────────────────────────────────────────────────────

export async function checkVibeStackSecurity(
  html: string,
  _baseUrl: string,
  tier: string,
): Promise<ScanVulnerability[]> {
  const findings: ScanVulnerability[] = [];

  // Run Supabase and Firebase probes in parallel
  const tasks: Promise<void>[] = [
    runSupabaseProbes(html, tier, findings),
    runFirebaseProbes(html, findings),
  ];

  await Promise.allSettled(tasks);
  return findings;
}

