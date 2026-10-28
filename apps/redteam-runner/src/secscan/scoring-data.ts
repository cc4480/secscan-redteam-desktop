/**
 * Data module: root-cause synonym catalog for corroboration merging.
 * Extracted from scoring.ts to reduce that file's line count.
 */

import type { ScanVulnerability } from "./scanner";

// ─── Root-cause synonym catalog ───────────────────────────────────────────────
// Maps known finding name patterns to a canonical root-cause key so that
// independent scanner checks that detect the same underlying vulnerability
// (e.g. SSL Labs TLS grade + our basic TLS check) get merged together.

export const ROOT_CAUSE_PATTERNS: Array<{ pattern: RegExp; key: string }> = [
  // Transport Security — TLS quality (SSL Labs grade and basic TLS check)
  { pattern: /weak tls|ssl labs.*grade|tls.*grade|tls configuration/i, key: "transport::tls-quality" },
  // Transport Security — HSTS missing
  { pattern: /hsts|strict.transport.security/i,                         key: "transport::hsts" },
  // Injection Defense — CSP missing
  { pattern: /(content.security.policy|(?<!\w)csp(?!\w)).*(missing|absent|not set)/i, key: "injection::csp-missing" },
  // Injection Defense — CSP unsafe directives
  { pattern: /unsafe.inline|unsafe.eval/i,                              key: "injection::csp-unsafe" },
  // UI Security — Clickjacking / X-Frame-Options
  { pattern: /x-frame.options|clickjack|frame.ancestors/i,              key: "ui::clickjacking" },
  // Content Sniffing — X-Content-Type-Options
  { pattern: /x-content-type.options|content.type.sniff|nosniff/i,      key: "content::nosniff" },
  // Information Disclosure — Server version
  { pattern: /server.*version|version.*disclosure|server.*header/i,     key: "disclosure::server-version" },
  // Information Disclosure — X-Powered-By
  { pattern: /x-powered-by/i,                                           key: "disclosure::x-powered-by" },
  // CORS — wildcard origin
  { pattern: /cors.*wildcard|wildcard.*cors|access.control.allow.origin.*\*/i, key: "cors::wildcard" },
  // Browser Feature Control — Referrer-Policy
  { pattern: /referrer.policy/i,                                        key: "browser::referrer-policy" },
  // Browser Feature Control — Permissions-Policy
  { pattern: /permissions.policy|feature.policy/i,                      key: "browser::permissions-policy" },
  // NOTE: cookie flag findings (Secure / HttpOnly / SameSite) are intentionally
  // NOT merged — each controls a distinct security property and must remain
  // independently reportable and dismissible.
];
