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
export declare const RESEARCH_TOOL_NAMES: Set<string>;
export declare function handleResearchTools(ctx: Ctx, _role: ActorRole, phase: EngagementPhase, call: ToolCallRequest, args: Record<string, unknown>): Promise<DispatchResult | null>;
