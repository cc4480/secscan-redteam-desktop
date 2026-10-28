/**
 * Confidence scoring — assigns a 0–100 confidence score to every finding.
 *
 * Confidence ≠ Severity. Severity (CVSS) measures impact if exploited.
 * Confidence measures how certain we are that the finding is real and
 * reproducible, not a false positive.
 *
 * Model: base score by detection class + modifiers for:
 *   - Evidence quality (multi-line request/response context)
 *   - Number of independent detection signals
 *   - Taxonomic specificity (CWE / WSTG presence = well-defined finding class)
 *
 * The auto-enrichment pass runs in the scanner orchestrator so individual
 * check modules don't need to import this file directly.
 */

import type { ScanVulnerability } from "./scanner";

// ─── Detection Classes ────────────────────────────────────────────────────────

export type DetectionClass =
  /** Payload executed and file content / redirect target confirmed in response */
  | "confirmed_exploit"
  /** Sensitive file fetched and body matched an expected content pattern */
  | "confirmed_exposure"
  /** Active HTTP probe sent; meaningful response difference observed */
  | "active_behavioral"
  /** Passive check with body or header regex validation */
  | "validated_passive"
  /** Security header completely absent from response */
  | "header_absent"
  /** Security header present but value is insecure or misconfigured */
  | "header_misconfigured"
  /** DNS record absent or misconfigured (deterministic lookup) */
  | "dns_record"
  /** Technology version string mapped to CVE — may have false positives */
  | "version_heuristic"
  /** NXDOMAIN + CNAME pattern — possible subdomain takeover, needs verification */
  | "subdomain_heuristic"
  /** Regex match in JS/HTML source — pattern-based, occasional false positives */
  | "secret_regex"
  /** Low-signal informational finding */
  | "info_disclosure";

// ─── Base scores ──────────────────────────────────────────────────────────────

const BASE_SCORES: Record<DetectionClass, number> = {
  confirmed_exploit:    95,
  confirmed_exposure:   88,
  dns_record:           80,
  active_behavioral:    78,
  validated_passive:    72,
  header_absent:        68,
  header_misconfigured: 65,
  secret_regex:         55,
  subdomain_heuristic:  52,
  version_heuristic:    48,
  info_disclosure:      42,
};

// ─── computeConfidence ────────────────────────────────────────────────────────

export interface ConfidenceOpts {
  /** Number of independent detection signals (default 1); each extra adds +5, capped at +15 */
  signals?: number;
  /** Multi-line evidence (request + response context) boosts score */
  evidence?: string | null;
  /** CWE ID presence means a well-defined vulnerability class → +3 */
  cweId?: string | null;
  /** WSTG ID means a formally specified test case → +2 */
  wstgId?: string | null;
}

export function computeConfidence(
  detectionClass: DetectionClass,
  opts: ConfidenceOpts = {},
): number {
  let score = BASE_SCORES[detectionClass];
  const { signals = 1, evidence, cweId, wstgId } = opts;

  // Evidence quality — multi-line means request + response context was captured
  if (evidence) {
    const newlines = (evidence.match(/\n/g) ?? []).length;
    if (newlines >= 3) score += 7;
    else if (newlines >= 1) score += 4;
  }

  // Additional independent signals (each adds confidence, capped at +15)
  if (signals > 1) score += Math.min((signals - 1) * 5, 15);

  // Taxonomic specificity bonuses
  if (cweId)  score += 3;
  if (wstgId) score += 2;

  return Math.min(100, Math.max(10, Math.round(score)));
}

// ─── Corroboration merge pass ─────────────────────────────────────────────────

import { ROOT_CAUSE_PATTERNS } from "./scoring-data";


function getRootCauseKey(category: string, name: string): string {
  for (const { pattern, key } of ROOT_CAUSE_PATTERNS) {
    if (pattern.test(name)) return key;
  }
  // Default: category + normalized name
  return `${category.toLowerCase()}::${name.toLowerCase().replace(/\s+/g, " ").trim()}`;
}

/**
 * Groups findings that share the same root cause (by synonym catalog or exact match).
 * When multiple independent detection methods fire for the same underlying vulnerability,
 * they are merged into a single finding with a confidence floor of 90 and the richest
 * evidence text.
 *
 * Findings that are unique (no duplicate root cause) pass through unchanged.
 */
export function corroborateMerge(vulns: ScanVulnerability[]): ScanVulnerability[] {
  const groups = new Map<string, ScanVulnerability[]>();
  for (const v of vulns) {
    const k = getRootCauseKey(v.category, v.name);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(v);
  }

  const result: ScanVulnerability[] = [];
  for (const [, group] of groups) {
    if (group.length === 1) {
      result.push(group[0]);
      continue;
    }

    // Pick the canonical finding — highest severity first, then confidence as tiebreaker
    const SEVERITY_ORDER: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
    const canonical = group.reduce((best, v) => {
      const bSev = SEVERITY_ORDER[best.severity?.toLowerCase() ?? ""] ?? 0;
      const vSev = SEVERITY_ORDER[v.severity?.toLowerCase() ?? ""] ?? 0;
      if (vSev !== bSev) return vSev > bSev ? v : best;
      return (v.confidence ?? 0) >= (best.confidence ?? 0) ? v : best;
    });

    const highestConf = canonical.confidence ?? 50;
    const merged: ScanVulnerability = {
      ...canonical,
      // Floor at 90 when corroborated — multiple signals remove most doubt
      confidence: Math.max(90, highestConf),
      // Concatenate unique evidence snippets from all detection signals
      evidence: [
        ...new Set(
          group
            .map((v) => v.evidence)
            .filter((e): e is string => !!e && e.length > 0),
        ),
      ].join("\n---\n") || canonical.evidence,
    };
    result.push(merged);
  }

  return result;
}

// ─── Auto-enrichment pass ─────────────────────────────────────────────────────

/**
 * Post-processing pass run by the scanner orchestrator.
 * Assigns confidence to every vulnerability that doesn't already have one,
 * inferring the detection class from available finding metadata.
 */
export function autoEnrichConfidence(vulns: ScanVulnerability[]): ScanVulnerability[] {
  return vulns.map((v) => {
    if (v.confidence != null) return v;
    return { ...v, confidence: inferConfidence(v) };
  });
}

// ─── Confidence inference lookup table ───────────────────────────────────────

type InferRule = {
  test: (ev: string, name: string, cat: string, v: ScanVulnerability) => boolean;
  cls: DetectionClass;
};

const INFER_RULES: InferRule[] = [
  {
    test: (ev) =>
      /root:x:0:0:|daemon:[x*]:\d+:\d+:|nobody:[x*]:\d+:\d+:/i.test(ev) ||
      /\[fonts\]|\[extensions\]|\[mci extensions\]/i.test(ev) ||
      /location:.*evil-redirect-probe/i.test(ev),
    cls: "confirmed_exploit",
  },
  {
    test: (_e, _n, cat, v) =>
      (cat.includes("source code") || cat.includes("credential") || cat.includes("data exposure")) &&
      (v.evidence ?? "").length > 40,
    cls: "confirmed_exposure",
  },
  { test: (_e, _n, cat) => cat.includes("email") || cat.includes("dns"),       cls: "dns_record"          },
  { test: (_e, _n, cat) => cat.includes("cve") || cat.includes("outdated"),    cls: "version_heuristic"   },
  { test: (_e, name)    => name.includes("subdomain") && name.includes("takeover"), cls: "subdomain_heuristic" },
  { test: (_e, _n, cat) => cat.includes("secret") || cat.includes("credentials"), cls: "secret_regex"     },
  {
    test: (_e, name, cat) =>
      name.includes("open redirect") || name.includes("http method") ||
      name.includes("cors")          || name.includes("error disclosure") ||
      name.includes("directory listing") || name.includes("rate limit") ||
      name.includes("source map")    || name.includes("path traversal") ||
      cat.includes("unvalidated redirect"),
    cls: "active_behavioral",
  },
  {
    test: (_e, name) =>
      /unsafe-inline|unsafe-eval|wildcard|disabled|allows\s+unsafe/i.test(name) ||
      name.includes("misconfigured") || name.includes("bypassed") || name.includes("incorrect"),
    cls: "header_misconfigured",
  },
  { test: (ev, name) => ev.includes("(header absent") || /\b(no |missing |absent )/i.test(name), cls: "header_absent" },
];

function inferConfidence(v: ScanVulnerability): number {
  const ev   = v.evidence ?? "";
  const name = v.name.toLowerCase();
  const cat  = v.category.toLowerCase();
  const opts: ConfidenceOpts = { evidence: ev, cweId: v.cweId, wstgId: v.wstgId };

  for (const rule of INFER_RULES) {
    if (rule.test(ev, name, cat, v)) return computeConfidence(rule.cls, opts);
  }
  if (v.severity === "info") return computeConfidence("info_disclosure", opts);
  return computeConfidence("validated_passive", opts);
}
