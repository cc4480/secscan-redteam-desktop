/**
 * Nuclei bridge tool handler: nuclei_exec (v0.21.0).
 *
 * Mirrors the msf_exec dispatcher shape: ROE technique check, explicit
 * targetProfile pinning (windows|linux, never inferred), exploit-phase
 * gating for `run`, per-call abort signal, DENIED/ABORTED mapping,
 * coverage counting, per-item attempt recording.
 */
import { BATTERY_CATEGORIES, type BatteryCategory } from "../battery.js";
import { type TargetId, isTargetId } from "../targets.js";
import { techniqueAllowed } from "../gate.js";
import { sleep } from "../util.js";
import { type Ctx } from "../context.js";
import { type ActorRole, type EngagementPhase } from "../types.js";
import type { ToolCallRequest } from "@secscan/redteam-llm-router";
import { type DispatchResult } from "./types.js";
import { toolTimeoutResult } from "./timeout.js";
import { noteCategoryCoverage, strListArg } from "./prelude.js";
import { mapTemplateToBattery, overlapHint, resolveNucleiTimeoutS } from "../nuclei/index.js";

function strArg(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

export async function handleNucleiTools(ctx: Ctx, _role: ActorRole, phase: EngagementPhase, call: ToolCallRequest, args: Record<string, unknown>, _seam?: unknown, dispatchSignal?: AbortSignal): Promise<DispatchResult | null> {
  if (call.name !== "nuclei_exec") return null;
  const attackId = strArg(args, "attackId")?.toUpperCase();
  const rawCat = (strArg(args, "category") ?? "").toLowerCase();
  const category = (BATTERY_CATEGORIES as string[]).includes(rawCat) ? (rawCat as BatteryCategory) : undefined;
  if (!techniqueAllowed(attackId, ctx.input.mode, ctx.input.roe, { testMode: ctx.config?.testMode === true })) {
    return { result: `DENIED by ROE: technique ${attackId} is excluded for this engagement.`, attackId, target: String(args["host"] ?? "") };
  }
  const rawTp = (strArg(args, "targetProfile") ?? "").toLowerCase();
  if (!isTargetId(rawTp) || (rawTp !== "windows" && rawTp !== "linux")) {
    return {
      result: `DENIED: nuclei_exec requires targetProfile "windows"|"linux" (host targets are never inferred) — got ${JSON.stringify(args["targetProfile"] ?? null)}.`,
      attackId,
      target: String(args["host"] ?? ""),
    };
  }
  const action = args["action"] === "run" ? "run" : "templates";
  if (action === "run" && phase !== "exploit") {
    return {
      result: `DENIED: nuclei_exec run executes templates against a target — allowed in the exploit phase only, after the recon→exploit coordinator sign-off. Current phase: ${phase}.`,
      attackId,
      target: String(args["host"] ?? ""),
    };
  }
  const host = String(args["host"] ?? "");
  ctx.probesUsed++;
  noteCategoryCoverage(ctx, category, rawTp as TargetId);
  const ctrl: { signal: AbortSignal } = { signal: dispatchSignal ?? new AbortController().signal };
  try {
    if (ctx.input.mode === "black") await sleep(Math.random() * 2500); // jitter
    const exec = ctx.nucleiExecutor;
    const filter = {
      ids: strListArg(args, "ids"),
      tags: strListArg(args, "tags"),
      severities: strListArg(args, "severities"),
      cve: strArg(args, "cve"),
    };
    if (action === "templates") {
      const res = await exec.templates({ filter });
      if (res.refused) return { result: `DENIED by nuclei safety policy: ${res.refused}`, attackId, target: host };
      return { result: `${res.summary}\n${res.output}`, attackId, target: host };
    }
    const res = await exec.run({
      host,
      scopeHosts: ctx.hosts,
      scheme: args["scheme"] === "http" ? "http" : "https",
      filter,
      severity: strListArg(args, "severities"),
      rateLimit: ctx.safety.rpsPerHost,
      signal: ctrl.signal,
    });
    if (res.refused) return { result: `DENIED by nuclei safety policy: ${res.refused}`, attackId, target: host };
    if (res.timedOut) {
      // Q-TOOLTIMEOUT §2.5 adoption: the executor-timeout path returns the
      // typed TOOL_TIMEOUT result (budget = the executor's own spawn
      // deadline), never the old ABORTED free text — a timeout of our own
      // tool is not target distress. Partial output rides after the
      // canonical text.
      const t = toolTimeoutResult({ toolName: "nuclei_exec", timeoutMs: resolveNucleiTimeoutS() * 1000 + 15000, target: host });
      return { ...t, result: res.output ? `${t.result} Partial results below.\n${res.output}` : t.result, attackId };
    }
    // Honest counting: template executions are variant-level checks, tracked
    // separately from the 418 intents (see nuclei/reporting.ts).
    ctx.nuclei.templateExecutions++;
    ctx.nuclei.templatesRun += res.templatesExecuted && res.templatesExecuted > 0 ? res.templatesExecuted : 0;
    ctx.nuclei.findings += res.findings.length;
    const tp = rawTp as "windows" | "linux";
    const hints = res.findings.slice(0, 10).map((f) => {
      const o = mapTemplateToBattery(f, tp);
      return `${f.templateId}: ${overlapHint(o)}`;
    });
    const hintBlock = hints.length ? `\nDedupe guidance:\n${hints.join("\n")}` : "";
    return { result: `${res.summary}\n${res.output}${hintBlock}`, attackId, target: host };
  } finally {
  }
}
