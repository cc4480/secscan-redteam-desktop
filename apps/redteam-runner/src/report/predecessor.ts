/**
 * Predecessor resolution + detail-input assembly (Q-REPORT-DETAIL, spec
 * §§1.2–1.3): find the recorded same-engine predecessor, load its
 * findings and posture of record, extract the surface/arm facts the
 * current record actually carries, shape all of it into DetailInput.
 * A candidate failing any §1.2 rule is skipped, never repaired; a fact
 * the record does not carry stays absent; every read is best-effort —
 * a resolution failure yields no baseline, never a broken report.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { BATTERY_CATEGORIES } from "../battery.js";
import { type Ctx, type LiveFinding } from "../context.js";
import { readState } from "../events.js";
import { bundleFileName, type PocBundle } from "../proof/index.js";
import { type EngagementEvent, type Finding } from "../types.js";
import { type ArmRun, type BaselineInput, type DetailFindingInput, type DetailInput, type DetailSeverity } from "./detail.js";
import { gradeFindings } from "./grading.js";
import { type ReportMeta } from "./html.js";
import { tierOf, type FindingMeta } from "./html/cards.js";

const SEVERITIES: readonly string[] = ["critical", "high", "medium", "low", "info"];

function severityOf(s: string): DetailSeverity {
  return (SEVERITIES.includes(s) ? s : "info") as DetailSeverity;
}

/** §1.2 target normalization: lowercase scheme+host, default ports
 * stripped, a single trailing slash on an empty path stripped, non-empty
 * paths kept verbatim — a different path is a different target. */
export function normalizeTargetKey(raw: string): string {
  try {
    const u = new URL(raw.trim());
    const scheme = u.protocol.replace(/:$/, "").toLowerCase();
    const host = u.hostname.toLowerCase();
    const port = u.port && !((scheme === "https" && u.port === "443") || (scheme === "http" && u.port === "80")) ? `:${u.port}` : "";
    const path = u.pathname === "/" ? "" : u.pathname;
    return `${scheme}://${host}${port}${path}`;
  } catch {
    return raw.trim().toLowerCase();
  }
}

interface ReportMetaRecord {
  dryRun?: boolean;
  score?: number;
  grade?: string;
}

function readReportMeta(dir: string): ReportMetaRecord | null {
  try {
    const raw = JSON.parse(readFileSync(join(dir, "report-meta.json"), "utf8")) as ReportMetaRecord;
    return raw && typeof raw === "object" ? raw : null;
  } catch {
    return null;
  }
}

/** Record this engagement's posture of record for future diffs (§1.2.7:
 * engagements written before this record existed resolve counts-only). */
export function recordReportMeta(ctx: Ctx, posture: { score: number; grade: string }): void {
  try {
    writeFileSync(
      join(ctx.events.dir, "report-meta.json"),
      JSON.stringify(
        {
          version: 1, engagementId: ctx.events.engagementId, target: ctx.input.target,
          startedAt: ctx.events.snapshot.startedAt, dryRun: !!ctx.config.dryRunAgents,
          score: posture.score, grade: posture.grade,
        },
        null, 2,
      ),
    );
  } catch {
    /* the record is an aid to future reports — never a reason to break this one */
  }
}

function isDryRunDir(dir: string, meta: ReportMetaRecord | null): boolean {
  if (meta && typeof meta.dryRun === "boolean") return meta.dryRun;
  try {
    return readFileSync(join(dir, "report.md"), "utf8").startsWith("# Engagement report (dry-run)");
  } catch {
    return false;
  }
}

function baselineFindings(dir: string, findings: Finding[]): DetailFindingInput[] {
  const out: DetailFindingInput[] = [];
  for (const f of findings) {
    if (f.status === "killed") continue;
    let tier: DetailFindingInput["tier"] = f.status === "deferred" ? "deferred" : "confirmed";
    if (tier === "confirmed") {
      try {
        const bundle = JSON.parse(readFileSync(join(dir, "poc", bundleFileName(f.id)), "utf8")) as { validationTier?: string };
        if (bundle.validationTier === "execution") tier = "proven";
      } catch {
        /* no bundle on disk — the finding stays confirmed */
      }
    }
    out.push({
      id: f.id, title: f.title, severity: severityOf(f.severity), tier,
      attackIds: f.attackIds ?? [], sourceLabel: "", signals: [], fix: f.fix ?? "",
    });
  }
  return out;
}

/** §1.2 predecessor resolution over the sibling engagement directories. */
export function resolvePredecessor(ctx: Ctx): BaselineInput | undefined {
  const engagementsDir = dirname(ctx.events.dir);
  const currentKey = normalizeTargetKey(ctx.input.target);
  const currentStarted = ctx.events.snapshot.startedAt;
  const currentDry = !!ctx.config.dryRunAgents;
  let best: { startedAt: string; baseline: BaselineInput } | undefined;
  let names: string[];
  try {
    names = readdirSync(engagementsDir);
  } catch {
    return undefined;
  }
  for (const name of names) {
    if (name === ctx.events.engagementId) continue;
    const dir = join(engagementsDir, name);
    try {
      if (!existsSync(join(dir, "report.md")) || !existsSync(join(dir, "item-verdicts.json"))) continue;
      const state = readState(dir);
      if (!state || state.status !== "complete") continue;
      if (!(state.startedAt < currentStarted)) continue;
      if (normalizeTargetKey(state.target) !== currentKey) continue;
      const meta = readReportMeta(dir);
      if (isDryRunDir(dir, meta) !== currentDry) continue;
      if (best && state.startedAt <= best.startedAt) continue;
      best = {
        startedAt: state.startedAt,
        baseline: {
          engagementId: state.engagementId,
          startedAt: state.startedAt,
          dryRun: currentDry,
          ...(meta && typeof meta.score === "number" ? { score: meta.score, grade: meta.grade } : {}),
          findings: baselineFindings(dir, state.findings ?? []),
        },
      };
    } catch {
      /* an unreadable sibling is not a baseline — skip it */
    }
  }
  return best?.baseline;
}

const normTitle = (s: string): string =>
  s.toLowerCase().replace(/\s+/g, " ").trim().replace(/[.!?;:]+$/, "");

/** Source labels detail.ts may treat as arm claims: the §7.1 arms in
 * their recorded spellings, or a multi-word SecScan engine category.
 * Any other single token is an agent-chosen vuln class, not an arm —
 * it is dropped here so the finding attributes by its family signals
 * instead of tripping detail.ts's fail-loud arm check (§7.4). */
const KNOWN_ARM_TOKENS: ReadonlySet<string> = new Set([
  "bola", "bola_idor", "api", "api_sec", "webhook", "webhook_signature", "redteam", "redteam_probe",
  "csrf", "dom_xss", "stored_xss", "deserialization", "prototype_pollution", "price_manipulation",
  "auth_rate_limit", "weak_session", "i18n", "edge_function", "llm", "credential_chain",
]);

export function armLabelOf(vulnClass: string | undefined): string {
  const raw = (vulnClass ?? "").trim();
  if (!raw) return "";
  if (/\s/.test(raw)) return raw;
  const norm = raw.toLowerCase().replace(/-/g, "_");
  return KNOWN_ARM_TOKENS.has(norm) || norm.startsWith("aggressive_") ? raw : "";
}

/** Join report findings to live findings (normalized title + attackId,
 * the verdicts discipline) so each finding carries its recorded source
 * label into the derivations. Each live finding is consumed once. */
export function joinLiveLabels(
  findings: Finding[],
  live: LiveFinding[],
): Map<string, LiveFinding> {
  const pool = [...live];
  const out = new Map<string, LiveFinding>();
  for (const f of findings) {
    const title = normTitle(f.title);
    let idx = pool.findIndex(
      (lf) => normTitle(lf.title) === title && f.attackIds.some((a) => a.toUpperCase() === lf.attackId.toUpperCase()),
    );
    if (idx === -1) {
      const titleOnly = pool.filter((lf) => normTitle(lf.title) === title);
      if (titleOnly.length === 1) idx = pool.indexOf(titleOnly[0]!);
    }
    if (idx >= 0) out.set(f.id, pool.splice(idx, 1)[0]!);
  }
  return out;
}

const DAST_RESULT = /^seclayer_dast\/([a-z0-9_-]+)\s/i;

/** Arm runs the event log proves: engine tool actions, plus DAST probe
 * names from the handlers' own result labels. Nothing else is claimed. */
export function extractArmRuns(events: EngagementEvent[]): ArmRun[] {
  const ran = new Set<string>();
  for (const e of events) {
    if (e.action === "seclayer_bola") ran.add("bola");
    else if (e.action === "seclayer_api") ran.add("api");
    else if (e.action === "seclayer_webhook") ran.add("webhook");
    else if (e.action === "seclayer_redteam") ran.add("redteam");
    else if (e.action === "secscan_exec") ran.add("secscan-engine");
    else if (e.action === "seclayer_dast") {
      const m = DAST_RESULT.exec(e.result ?? "");
      if (m) ran.add(m[1]!.replace(/-/g, "_"));
    }
  }
  return [...ran].map((name) => ({ name, state: "ran" as const }));
}

export interface DetailAssemblyDeps {
  ctx: Ctx;
  findings: Finding[];
  bundles: ReadonlyMap<string, PocBundle>;
  findingMeta: ReadonlyMap<string, FindingMeta>;
  totals: DetailInput["coverage"]["totals"];
  cells: { target: string; category: string; state: string }[];
  planOnly: string[];
  events: EngagementEvent[];
}

/** Assemble the DetailInput + the meta.baseline stamp for one report. */
export function buildDetailInput(deps: DetailAssemblyDeps): {
  input: DetailInput;
  baselineMeta?: ReportMeta["baseline"];
} {
  const { ctx, findings } = deps;
  const posture = gradeFindings(findings);
  const labels = joinLiveLabels(findings, ctx.liveFindings);
  const detailFindings: DetailFindingInput[] = [];
  const tierCounts = { proven: 0, confirmed: 0, deferred: 0 };
  for (const f of findings) {
    const tier = tierOf(f, deps.bundles.get(f.id));
    if (tier === "ruled-out") continue;
    tierCounts[tier]++;
    const meta = deps.findingMeta.get(f.id);
    detailFindings.push({
      id: f.id,
      title: f.title,
      severity: severityOf(f.severity),
      tier,
      attackIds: f.attackIds ?? [],
      sourceLabel: armLabelOf(labels.get(f.id)?.vulnClass),
      signals: [meta?.category, meta?.owasp, meta?.cwe].filter((s): s is string => !!s),
      fix: f.fix ?? "",
    });
  }
  const worst = [...detailFindings]
    .filter((f) => f.tier !== "deferred")
    .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.id.localeCompare(b.id))[0];
  const baseline = resolvePredecessor(ctx);
  const pathItems = [...ctx.itemLedger.values()].filter((v) => /path/i.test(v.name));
  const input: DetailInput = {
    target: ctx.input.target,
    mode: ctx.input.mode,
    dryRun: !!ctx.config.dryRunAgents,
    posture: { score: posture.score, grade: posture.grade, postureRating: posture.postureRating },
    worstConfirmed: worst ? { id: worst.id, severity: worst.severity, title: worst.title } : null,
    findingsBySeverity: posture.findingsBySeverity as Record<DetailSeverity, number>,
    tierCounts,
    findings: detailFindings,
    ...(baseline ? { baseline } : {}),
    coverage: {
      totals: deps.totals,
      probesUsed: ctx.probesUsed,
      fullBattery: !!ctx.input.fullBattery,
      notCovered: ctx.input.fullBattery
        ? deps.cells.filter((c) => c.state === "missing").map((c) => `${c.target}:${c.category}`)
        : BATTERY_CATEGORIES.filter((c) => !ctx.coverage.has(c)),
      planOnly: deps.planOnly,
      arms: extractArmRuns(deps.events),
      ...(pathItems.length > 0
        ? { pathProbes: {
              executed: pathItems.filter((v) => v.disposition === "executed-clean" || v.disposition === "confirmed").length,
              confirmedAmong: pathItems.filter((v) => v.disposition === "confirmed").length } }
        : {}),
      ...(ctx.targetMap.length > 0 ? { endpointsDiscovered: ctx.targetMap.length } : {}),
    },
    surface: {
      ...(ctx.fingerprint.stack.length > 0 ? { technologies: [...ctx.fingerprint.stack] } : {}),
    },
  };
  return {
    input,
    baselineMeta: baseline
      ? { engagementId: baseline.engagementId, startedAt: baseline.startedAt,
          ...(typeof baseline.score === "number" ? { score: baseline.score, grade: baseline.grade } : {}) }
      : undefined,
  };
}
