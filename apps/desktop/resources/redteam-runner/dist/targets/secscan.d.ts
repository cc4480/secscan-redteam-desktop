/**
 * SecScan target profile — the scanner webapp (https://secscan.us).
 *
 * EXHAUSTIVE battery (v0.7.0): surface × technique. Every distinct attacker
 * intent against the real surface is one item. Surfaces: scan intake
 * (URL field + options), SSRF guard, DNS TXT ownership gate, scan
 * lifecycle, scan listing, report view/export, share links, AI opt-out,
 * rate limits, auth/session, API surface, TLS/headers/CORS, error
 * handlers, scanner-efficacy canaries, cross-cutting.
 *
 * Non-destructive always: never trigger emails to real users, never delete
 * scans/reports, benign canary content only, races are single paired
 * requests. Items needing setup say so in `needs` — honestly.
 */
import type { TargetProfile } from "./types.js";
export declare const SECSCAN_PROFILE: TargetProfile;
