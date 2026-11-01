/**
 * seclayer_dast handler — the embedded Seclayer DAST-unique probes,
 * selected by the `probe` argument. Same verification gate, prelude,
 * and finding-recording path as the other Seclayer tools (see
 * dispatch/seclayer.ts); this file only routes each probe name to its
 * module with the discovery inputs the fleet's recon supplied.
 *
 * Probe inventory (module → what it proves):
 *   csrf               csrfProbe.assessCsrf — SameSite=None session +
 *                      tokenless state-changing form (posture finding)
 *   stored_xss         storedXss.probeStoredXss — payload persisted
 *                      and re-served unescaped through a form
 *   dom_xss            domXss.probeDomXss — hash-to-sink execution in
 *                      a headless browser (no-op unless rendering is
 *                      enabled in-process)
 *   price_manipulation priceManipulationProbe — checkout total tamper
 *   prototype_pollution prototypePollutionProbe — __proto__ gadget
 *   deserialization    deserializationScan.scanCookiesForSerialized —
 *                      serialized-object markers in Set-Cookie lines
 *   credential_chain   credentialChainProbe — exposed backend key
 *                      pairs that unlock the backend they protect
 *   auth_rate_limit    authRateLimitProbe — credential endpoints that
 *                      accept unlimited password attempts
 *   llm                llmProbe — prompt injection / memory poisoning
 *                      / insecure tool use on discovered LLM endpoints
 *   edge_function      edgeFunctionProbe — edge-function URLs missing
 *                      the page's own auth
 *   i18n               i18nProbe — locale-prefix auth bypass (a gated
 *                      path reachable under an ungated locale prefix)
 *   weak_session       weakSessionToken.probeWeakSessionToken — one
 *                      owner-supplied login, then session-token
 *                      predictability analysis
 */
import { type Ctx } from "../context.js";
import { type ActorRole, type EngagementPhase } from "../types.js";
import type { ToolCallRequest } from "@secscan/redteam-llm-router";
import { type DispatchResult } from "./types.js";
export declare function handleSeclayerDastTool(ctx: Ctx, _role: ActorRole, _phase: EngagementPhase, call: ToolCallRequest, args: Record<string, unknown>): Promise<DispatchResult | null>;
