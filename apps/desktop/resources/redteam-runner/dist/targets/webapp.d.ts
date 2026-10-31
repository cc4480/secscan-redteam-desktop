/**
 * Webapp target profile - a GENERIC client web application (v0.36.0).
 *
 * This is the customer-facing battery (WA-001..WA-144). It is the executable
 * form of the SecScan (VibeScan-Enterprise-Build) and Seclayer (seclayer.io2026)
 * scan corpora, so the agents run those checks natively against a client's
 * application instead of only through the two scanner products.
 *
 * It is OPT-IN: `--targets webapp` (CLI) or the start_engagement `targets`
 * argument (harness/agents). It is deliberately NOT part of
 * FULL_BATTERY_TARGETS, because against secscan.us / seclayer.app the generic
 * webapp battery would duplicate the SS-* / SL-* product-surface batteries.
 *
 * Unlike the four vendor batteries, the target host is the engagement's own
 * scope, so baseUrl is a placeholder rather than a fixed host.
 *
 * Non-destructive always: no request whose success changes customer data;
 * writes only as dry runs (for example Supabase INSERT with
 * `Prefer: tx=rollback` against a field no real schema has); DELETE only
 * against identifiers that cannot exist; no PUT; no bulk data extraction.
 * Items whose prerequisite is absent carry `needs` and report under Honest
 * limits - never pretending a test ran.
 */
import type { TargetProfile } from "./types.js";
export declare const WEBAPP_PROFILE: TargetProfile;
