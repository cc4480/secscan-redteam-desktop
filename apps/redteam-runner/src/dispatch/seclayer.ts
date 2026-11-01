/**
 * Native Seclayer module tool handlers (verification-gated).
 *
 * Runs the embedded Seclayer non-repeat modules in-process (vendored
 * under src/seclayer/, compiled to dist/seclayer/) instead of through
 * the Seclayer service. Every tool here fires ACTIVE web app tests —
 * real exploit attempts, authenticated two-identity probes, fuzzing —
 * so every call is refused unless owner verification is on the
 * engagement record (ctx.verificationProof, recorded by the authorize
 * phase after the owner proves the target is theirs, spec rule 7).
 * The refusal is agent-readable on purpose: it tells the fleet to
 * secure verification first and retry, exactly like secscan_exec's
 * deep tier.
 *
 * Findings flow onto the same proven path as every other tool:
 * verbatim severity/title per finding, PII redaction, the append-only
 * live list, the verdict registry, and a state sync.
 */
import { BATTERY_CATEGORIES, type BatteryCategory } from "../battery.js";
import { type TargetId, isTargetId } from "../targets.js";
import { techniqueAllowed } from "../gate.js";
import { redactPii } from "../safety/index.js";
import { type Ctx, type LiveFinding } from "../context.js";
import { type ActorRole, type EngagementPhase } from "../types.js";
import type { ToolCallRequest } from "@secscan/redteam-llm-router";
import { type DispatchResult } from "./types.js";
import { noteCategoryCoverage, strListArg } from "./prelude.js";
import { syncLiveFindingsToState, writeFindingToRegistry } from "./verdicts.js";
import { runRedTeamProbes } from "#seclayer/server/redTeamProbes.js";
import { bolaProbe } from "#seclayer/server/bola.js";
import { runApiSecProbes } from "#seclayer/server/apiProbes.js";
import { probeWebhookSignatureBypass } from "#seclayer/server/webhookSignatureProbe.js";
import { probeSsti } from "#seclayer/server/aggressive/ssti.js";
import { probeNoSql } from "#seclayer/server/aggressive/nosql.js";
import { probeXxe } from "#seclayer/server/aggressive/xxe.js";
import { probeCrlf } from "#seclayer/server/aggressive/crlfInjection.js";
import { probeHostHeaderInjection } from "#seclayer/server/aggressive/hostHeaderInjection.js";
import type { ProbeContext } from "#seclayer/server/redTeam/types.js";
import type { RedTeamFinding } from "#seclayer/server/scanTypes.js";
import type { BolaIdentity } from "#seclayer/src/types.js";

export const SECLAYER_TOOL_NAMES = new Set([
  "seclayer_redteam", "seclayer_bola", "seclayer_api",
  "seclayer_webhook", "seclayer_dast", "seclayer_aggressive",
]);

export function strArg(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

export function headersArg(args: Record<string, unknown>): Record<string, string> {
  const h = args["headers"];
  if (!h || typeof h !== "object" || Array.isArray(h)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

export interface SeclayerPrelude {
  attackId?: string;
  category?: BatteryCategory;
  targetProfile: TargetId;
  url: string;
  headers: Record<string, string>;
}

/** Shared gate for every Seclayer tool: ROE, scope-shaped args, and the
 * verification gate. Returns a denial DispatchResult, or the parsed
 * prelude when the call may proceed. */
export function seclayerPrelude(ctx: Ctx, call: ToolCallRequest, args: Record<string, unknown>): SeclayerPrelude | DispatchResult {
  const attackId = strArg(args, "attackId")?.toUpperCase();
  const url = strArg(args, "url") ?? "";
  const rawCat = (strArg(args, "category") ?? "").toLowerCase();
  const category = (BATTERY_CATEGORIES as string[]).includes(rawCat) ? (rawCat as BatteryCategory) : undefined;
  if (!techniqueAllowed(attackId, ctx.input.mode, ctx.input.roe, { testMode: ctx.config?.testMode === true })) {
    return { result: `DENIED by ROE: technique ${attackId} is excluded for this engagement.`, attackId, target: url };
  }
  if (!ctx.verificationProof) {
    return {
      result:
        `DENIED: ${call.name} runs verification-gated web app tests — active exploit attempts and authenticated probes that fire only with owner verification on record, and this engagement has none. ` +
        `Get verification from the owner that the target is theirs (the authorize phase records it on the engagement), then retry the same call. Passive coverage that needs no verification: secscan_exec at depth "passive".`,
      attackId,
      target: url,
    };
  }
  const rawTp = (strArg(args, "targetProfile") ?? "").toLowerCase();
  const targetProfile = isTargetId(rawTp) ? rawTp : "webapp";
  return { attackId, category, targetProfile, url, headers: headersArg(args) };
}

export function isDenial(x: SeclayerPrelude | DispatchResult): x is DispatchResult {
  return "result" in x;
}

/** One raw Seclayer finding (every module family shares this shape). */
export interface RawSeclayerFinding {
  testName?: string;
  title?: string;
  payload?: string;
  severity?: string;
  description?: string;
  fix?: string;
  endpoint?: string;
  evidence?: unknown;
}

function evidenceText(f: RawSeclayerFinding): string {
  const ev = f.evidence as { demonstration?: unknown; signal?: { quote?: unknown } } | string | undefined;
  if (typeof ev === "string" && ev.trim()) return ev;
  if (ev && typeof ev === "object") {
    const demo = typeof ev.demonstration === "string" ? ev.demonstration : "";
    const quote = ev.signal && typeof ev.signal.quote === "string" ? ` Signal: ${ev.signal.quote}` : "";
    if (demo || quote) return `${demo}${quote}`.trim();
  }
  return f.description ?? "";
}

/** Map a Seclayer module finding onto the runner's finding shape,
 * verbatim: module severity, the probe's own test name as the title,
 * its demonstrated receipt as the evidence. */
export function seclayerFindingToLive(
  f: RawSeclayerFinding,
  attackId: string | undefined,
  vulnClass: string,
): LiveFinding {
  return {
    severity: typeof f.severity === "string" && f.severity ? f.severity.toLowerCase() : "medium",
    title: f.testName ?? f.title ?? "Seclayer probe finding",
    vulnClass,
    attackId: attackId ?? "T1190",
    evidence: evidenceText(f),
    ...(typeof f.payload === "string" && f.payload ? { payload: f.payload } : {}),
  };
}

/** Record a batch of module findings on the proven path and summarize. */
export function recordSeclayerFindings(
  ctx: Ctx,
  tool: string,
  url: string,
  raw: RawSeclayerFinding[],
  pre: SeclayerPrelude,
  vulnClass: string,
  // Q-FLEET-XCHECK: the seat that ran the probe tool, stamped as the
  // findings' producer. Optional so direct callers (tests) keep working.
  producer?: ActorRole,
): DispatchResult {
  ctx.probesUsed++;
  noteCategoryCoverage(ctx, pre.category, pre.targetProfile);
  const recorded: LiveFinding[] = [];
  for (const f of raw) {
    const live = seclayerFindingToLive(f, pre.attackId, vulnClass);
    let title = redactPii(live.title);
    let evidence = redactPii(live.evidence);
    if (title.length > 200) title = title.slice(0, 197) + "...";
    if (evidence.length > 800) evidence = evidence.slice(0, 797) + "...";
    const stored: LiveFinding = { ...live, title, evidence, ...(producer ? { producer } : {}) };
    ctx.liveFindings.push(stored);
    writeFindingToRegistry(ctx, stored);
    recorded.push(stored);
  }
  syncLiveFindingsToState(ctx);
  const bySev = new Map<string, number>();
  for (const f of recorded) bySev.set(f.severity, (bySev.get(f.severity) ?? 0) + 1);
  const order = ["critical", "high", "medium", "low", "info"];
  const sevSummary = order.filter((s) => bySev.has(s)).map((s) => `${bySev.get(s)} ${s}`).join(", ");
  const lines = recorded.slice(0, 30).map((f) => `[${f.severity}] ${f.title}`);
  const result =
    recorded.length === 0
      ? `${tool} vs ${url} — 0 findings. The probes ran and proved nothing on this target; that is a clean result for these classes, not coverage of the whole battery.`
      : `${tool} vs ${url} — ${recorded.length} finding(s) recorded (of ${raw.length} returned): ${sevSummary}.\n${lines.join("\n")}\nFindings are now in the report set — retest the fixed build with the same call to close them.`;
  return { result, attackId: pre.attackId, target: url, ok: recorded.length > 0 };
}

export function bolaIdentitiesFromArgs(args: Record<string, unknown>): [BolaIdentity, BolaIdentity] | undefined {
  const aAuth = strArg(args, "aAuthHeader");
  const aRes = strArg(args, "aOwnResource");
  const bAuth = strArg(args, "bAuthHeader");
  const bRes = strArg(args, "bOwnResource");
  if (!aAuth || !aRes || !bAuth || !bRes) return undefined;
  const a: BolaIdentity = { label: "tenant-A", authHeader: aAuth, ownResource: aRes, ...(strArg(args, "aOwnMarker") ? { ownMarker: strArg(args, "aOwnMarker") } : {}) };
  const b: BolaIdentity = { label: "tenant-B", authHeader: bAuth, ownResource: bRes, ...(strArg(args, "bOwnMarker") ? { ownMarker: strArg(args, "bOwnMarker") } : {}) };
  return [a, b];
}

const AGGRESSIVE_PROBES: Record<string, (ctx: ProbeContext) => Promise<RedTeamFinding | null>> = {
  ssti: probeSsti,
  nosql: probeNoSql,
  xxe: probeXxe,
  crlf: probeCrlf,
  host_header: probeHostHeaderInjection,
};

export async function handleSeclayerTools(
  ctx: Ctx,
  _role: ActorRole,
  _phase: EngagementPhase,
  call: ToolCallRequest,
  args: Record<string, unknown>,
): Promise<DispatchResult | null> {
  if (!SECLAYER_TOOL_NAMES.has(call.name) || call.name === "seclayer_dast") return null;
  const pre = seclayerPrelude(ctx, call, args);
  if (isDenial(pre)) return pre;
  const { url, headers } = pre;
  try {
    if (call.name === "seclayer_redteam") {
      const findings = await runRedTeamProbes(url, headers, {});
      return recordSeclayerFindings(ctx, call.name, url, findings as RawSeclayerFinding[], pre, "redteam-probe", _role);
    }
    if (call.name === "seclayer_bola") {
      const identities = bolaIdentitiesFromArgs(args);
      if (!identities) {
        return { result: "DENIED: seclayer_bola needs both test identities — aAuthHeader/aOwnResource and bAuthHeader/bOwnResource.", attackId: pre.attackId, target: url, repairable: "seclayer_bola requires both test identities (aAuthHeader/aOwnResource and bAuthHeader/bOwnResource)" };
      }
      const findings = await bolaProbe(new URL(url).origin, identities, headers);
      return recordSeclayerFindings(ctx, call.name, url, findings as RawSeclayerFinding[], pre, "bola-idor", _role);
    }
    if (call.name === "seclayer_api") {
      const identities = bolaIdentitiesFromArgs(args);
      const findings = await runApiSecProbes(url, new URL(url).host, headers, identities ? { bolaIdentities: identities } : {});
      return recordSeclayerFindings(ctx, call.name, url, findings as RawSeclayerFinding[], pre, "api-sec", _role);
    }
    if (call.name === "seclayer_webhook") {
      const finding = await probeWebhookSignatureBypass(url, strListArg(args, "postUrls") ?? [], headers);
      return recordSeclayerFindings(ctx, call.name, url, finding ? [finding] : [], pre, "webhook-signature", _role);
    }
    // seclayer_aggressive
    const probeName = (strArg(args, "probe") ?? "").toLowerCase();
    const probe = AGGRESSIVE_PROBES[probeName];
    if (!probe) {
      return { result: `DENIED: seclayer_aggressive probe must be one of ${Object.keys(AGGRESSIVE_PROBES).join(", ")} — got ${JSON.stringify(args["probe"] ?? null)}.`, attackId: pre.attackId, target: url, repairable: `seclayer_aggressive probe must be one of ${Object.keys(AGGRESSIVE_PROBES).join(", ")}` };
    }
    const finding = await probe({ url, fuzzHeaders: headers });
    return recordSeclayerFindings(ctx, call.name, url, finding ? [finding] : [], pre, `aggressive-${probeName}`, _role);
  } catch (e) {
    return {
      result: `${call.name} vs ${url} — engine error, no findings recorded: ${e instanceof Error ? e.message : String(e)}`,
      attackId: pre.attackId,
      target: url,
      ok: false,
    };
  }
}
