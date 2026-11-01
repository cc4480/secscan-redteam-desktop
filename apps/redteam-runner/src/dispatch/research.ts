/**
 * Web research tool handlers: research_search, research_fetch — the
 * execution layer for the fleet's deep-research-osint skill.
 *
 * Unlike the target tools, these generate no target traffic, so they
 * take no target host and the router's host-keyed machinery (rate
 * limiter, auto-halt, duplicate guard) does not apply — the same
 * posture as the bookkeeping tools. The one gate that DOES bind them
 * is the skill's scope law, enforced here in the executor (never in
 * the schema or the prompt): a call naming a target-family host that
 * the engagement record does not allow is refused BEFORE the provider
 * is touched — zero lookups — with a `scope_exit` audit event whose
 * text carries the skill's SCOPE-EXIT marker. Every call also writes
 * its own audit event, and dispatch counts it toward maxActions like
 * every other tool (dispatchToolInner increments ctx.actions).
 */
import { type Ctx } from "../context.js";
import { type ActorRole, type EngagementPhase } from "../types.js";
import type { ToolCallRequest } from "@secscan/redteam-llm-router";
import { type DispatchResult } from "./types.js";
import { optStr, numArg } from "./prelude.js";
import {
  ResearchError,
  resolveSearchProvider,
  type ResearchSearchHit,
  type SearchProvider,
} from "../research/provider.js";
import { fetchPage } from "../research/fetch.js";
import { extractQueryHosts, researchScopeDenial } from "../research/scope.js";

export const RESEARCH_TOOL_NAMES = new Set(["research_search", "research_fetch"]);

const MAX_RESULTS = 10;
const DEFAULT_RESULTS = 8;

/** The provider for this call: the injected test seam wins, else the env-resolved live provider. */
function providerFor(ctx: Ctx): SearchProvider {
  return ctx.deps.researchProvider ?? resolveSearchProvider();
}

/** A typed research failure: stable code on the result, no invented content, the UNVERIFIED instruction. */
function researchFailure(tool: string, e: unknown): DispatchResult {
  const code = e instanceof ResearchError ? e.code : "RESEARCH_PROVIDER_ERROR";
  const message = e instanceof Error ? e.message : String(e);
  return {
    result:
      `${tool} failed (${code}): ${message}. ` +
      `No results were fabricated — retry, narrow the call, or proceed with the claim marked UNVERIFIED.`,
    ok: false,
    errorCode: code,
  };
}

/** The scope-law refusal: a scope_exit audit event plus the DENIED result, before any lookup. */
function scopeExit(
  ctx: Ctx,
  phase: EngagementPhase,
  host: string,
  reason: string,
): DispatchResult {
  const result =
    `DENIED by scope: SCOPE-EXIT: ${host} — ${reason}. ` +
    `Research directed at an out-of-scope target is refused with zero lookups; ` +
    `pivot to an in-scope target, or keep the research general (a CVE, a product, a technique).`;
  ctx.events.append({ phase, actor: "runner", action: "scope_exit", target: host, result });
  return { result, target: host, ok: false };
}

async function handleSearch(
  ctx: Ctx,
  phase: EngagementPhase,
  args: Record<string, unknown>,
): Promise<DispatchResult> {
  const query = optStr(args["query"]);
  if (!query) return { result: `DENIED: research_search requires a non-empty "query" argument.`, ok: false };
  const since = optStr(args["since"]);
  if (since !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(since) || Number.isNaN(Date.parse(since)))) {
    return { result: `DENIED: research_search "since" must be a yyyy-mm-dd date — got ${JSON.stringify(args["since"])}.`, ok: false };
  }
  const limit = Math.min(MAX_RESULTS, Math.max(1, Math.floor(numArg(args["limit"]) ?? DEFAULT_RESULTS)));
  const hosts = extractQueryHosts(query);
  const denial = researchScopeDenial(ctx, hosts);
  if (denial) return scopeExit(ctx, phase, denial.host, denial.reason);

  let hits: ResearchSearchHit[];
  let provider: SearchProvider;
  try {
    provider = providerFor(ctx);
    hits = await provider.search(query, { ...(since ? { since } : {}), limit });
  } catch (e) {
    return researchFailure("research_search", e);
  }
  const kept = hits.filter((h) => !since || !h.publishedDate || h.publishedDate >= since).slice(0, limit);
  const dropped = hits.length - kept.length;
  const stamp = new Date().toISOString();
  const head =
    `research_search via ${provider.id} at ${stamp} — query: ${JSON.stringify(query)}` +
    `${since ? ` (since ${since})` : ""} — ${kept.length} result(s)`;
  const lines: string[] = [head];
  kept.forEach((h, i) => {
    const meta = [h.source, h.publishedDate ?? "undated"].filter(Boolean).join(" · ");
    lines.push(`[${i + 1}] ${h.title} (${meta})`, `    ${h.url}`, `    ${h.snippet}`);
  });
  if (kept.length === 0) {
    lines.push(
      `No results. A negative result is a result: record where you looked; claims on this question stay UNVERIFIED.`,
    );
  } else {
    lines.push(`Cite as [n] with the exact URLs above; a claim with no result behind it is UNVERIFIED.`);
  }
  if (dropped > 0) {
    lines.push(
      `${dropped} returned result(s) known to predate since=${since} were omitted; undated results are kept and stamped undated.`,
    );
  }
  const result = lines.join("\n");
  ctx.events.append({
    phase,
    actor: "runner",
    action: "research_search",
    ...(hosts[0] ? { target: hosts[0] } : {}),
    result: `${head}${dropped > 0 ? `; ${dropped} predating since omitted` : ""}`,
  });
  return { result, ...(hosts[0] ? { target: hosts[0] } : {}), ok: true };
}

async function handleFetch(
  ctx: Ctx,
  phase: EngagementPhase,
  args: Record<string, unknown>,
): Promise<DispatchResult> {
  const url = optStr(args["url"]);
  if (!url) {
    return { result: `DENIED: research_fetch requires a "url" argument.`, ok: false, repairable: `research_fetch requires a url argument` };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { result: `DENIED: unparseable URL ${url}`, ok: false, target: url, repairable: `unparseable URL ${JSON.stringify(url)}` };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { result: `DENIED: research_fetch reads http/https URLs only — got ${JSON.stringify(parsed.protocol)}.`, ok: false, target: url };
  }
  const denial = researchScopeDenial(ctx, [parsed.hostname]);
  if (denial) return scopeExit(ctx, phase, denial.host, denial.reason);

  try {
    const page = await fetchPage(url);
    const redirected = page.finalUrl !== page.requestedUrl ? ` (redirected from ${page.requestedUrl})` : "";
    const result =
      `Source: ${page.finalUrl}${redirected}\n` +
      `Retrieved: ${page.retrievedAt} · content-type: ${page.contentType || "unknown"} · ${page.bytes} bytes` +
      `${page.truncated ? " · truncated at a cap (flagged in the text)" : ""}\n---\n${page.text}`;
    ctx.events.append({
      phase,
      actor: "runner",
      action: "research_fetch",
      target: page.finalUrl,
      result:
        `research_fetch ${parsed.hostname} — ${page.bytes} bytes, ${page.text.length} chars of text` +
        `${page.truncated ? " (truncated)" : ""}`,
    });
    return { result, target: page.finalUrl, ok: true };
  } catch (e) {
    return researchFailure("research_fetch", e);
  }
}

export async function handleResearchTools(
  ctx: Ctx,
  _role: ActorRole,
  phase: EngagementPhase,
  call: ToolCallRequest,
  args: Record<string, unknown>,
): Promise<DispatchResult | null> {
  if (!RESEARCH_TOOL_NAMES.has(call.name)) return null;
  return call.name === "research_search" ? handleSearch(ctx, phase, args) : handleFetch(ctx, phase, args);
}
