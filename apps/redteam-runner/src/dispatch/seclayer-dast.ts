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
import { strListArg } from "./prelude.js";
import {
  seclayerPrelude, isDenial, recordSeclayerFindings, strArg,
  type RawSeclayerFinding,
} from "./seclayer.js";
import { assessCsrf, type CsrfForm } from "#seclayer/server/csrfProbe.js";
import { probeStoredXss } from "#seclayer/server/storedXss.js";
import { probeDomXss } from "#seclayer/server/domXss.js";
import { probePriceManipulation } from "#seclayer/server/priceManipulationProbe.js";
import { probePrototypePollution } from "#seclayer/server/prototypePollutionProbe.js";
import { scanCookiesForSerialized } from "#seclayer/server/deserializationScan.js";
import { probeCredentialUrlPairs, extractUrlKeyPairs, type UrlKeyPair } from "#seclayer/server/credentialChainProbe.js";
import { probeAuthRateLimit } from "#seclayer/server/authRateLimitProbe.js";
import {
  probeLlmPromptInjection, probeLlmMemoryPoisoning, probeLlmInsecureToolUse,
} from "#seclayer/server/llmProbe.js";

/** The llmProbe modules' discovered-endpoint argument shape. */
type DiscoveredEndpoint = { url: string; method?: string; params?: string[] };
import { probeEdgeFunctionAuth } from "#seclayer/server/edgeFunctionProbe.js";
import { probeI18nAuthBypass } from "#seclayer/server/i18nProbe.js";
import { probeWeakSessionToken } from "#seclayer/server/redTeam/weakSessionToken.js";
import type { InjectableTarget } from "#seclayer/server/crawler.js";

function objListArg(args: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const v = args[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x));
}

function formTargetsArg(args: Record<string, unknown>): InjectableTarget[] {
  return objListArg(args, "formTargets") as unknown as InjectableTarget[];
}

export async function handleSeclayerDastTool(
  ctx: Ctx,
  _role: ActorRole,
  _phase: EngagementPhase,
  call: ToolCallRequest,
  args: Record<string, unknown>,
): Promise<DispatchResult | null> {
  if (call.name !== "seclayer_dast") return null;
  const pre = seclayerPrelude(ctx, call, args);
  if (isDenial(pre)) return pre;
  const { url, headers } = pre;
  const probe = (strArg(args, "probe") ?? "").toLowerCase();
  const postUrls = strListArg(args, "postUrls") ?? [];
  const cookieLines = strListArg(args, "cookieLines") ?? [];
  const deny = (msg: string): DispatchResult => ({ result: `DENIED: ${msg}`, attackId: pre.attackId, target: url });
  const done = (raw: RawSeclayerFinding[], cls: string): DispatchResult =>
    recordSeclayerFindings(ctx, `seclayer_dast/${probe}`, url, raw, pre, cls);
  try {
    switch (probe) {
      case "csrf": {
        const forms = objListArg(args, "forms") as unknown as CsrfForm[];
        const finding = assessCsrf(cookieLines, forms);
        return done(finding ? [finding as RawSeclayerFinding] : [], "csrf");
      }
      case "stored_xss": {
        const targets = formTargetsArg(args);
        if (targets.length === 0) return deny("seclayer_dast stored_xss needs formTargets from recon (discovered injectable form targets).");
        const findings = await probeStoredXss(targets, headers, {});
        return done(findings as RawSeclayerFinding[], "stored-xss");
      }
      case "dom_xss": {
        const findings = await probeDomXss(url, headers);
        return done(findings as RawSeclayerFinding[], "dom-xss");
      }
      case "price_manipulation": {
        const finding = await probePriceManipulation(url, postUrls, headers);
        return done(finding ? [finding] : [], "price-manipulation");
      }
      case "prototype_pollution": {
        const finding = await probePrototypePollution(url, postUrls, headers);
        return done(finding ? [finding] : [], "prototype-pollution");
      }
      case "deserialization": {
        const findings = scanCookiesForSerialized(cookieLines, url);
        return done(findings as unknown as RawSeclayerFinding[], "deserialization");
      }
      case "credential_chain": {
        let pairs = objListArg(args, "pairs") as unknown as UrlKeyPair[];
        const pageText = strArg(args, "pageText");
        if (pairs.length === 0 && pageText) pairs = extractUrlKeyPairs(pageText);
        if (pairs.length === 0) return deny("seclayer_dast credential_chain needs pairs or pageText containing exposed backend URL/key pairs.");
        const finding = await probeCredentialUrlPairs(pairs, undefined);
        return done(finding ? [finding] : [], "credential-chain");
      }
      case "auth_rate_limit": {
        const finding = await probeAuthRateLimit(url, postUrls, headers);
        return done(finding ? [finding] : [], "auth-rate-limit");
      }
      case "llm": {
        const discovered = objListArg(args, "discovered") as unknown as DiscoveredEndpoint[];
        if (discovered.length === 0) return deny("seclayer_dast llm needs discovered LLM endpoints from recon ({url, method?, params?}).");
        const origin = new URL(url).origin;
        const all: RawSeclayerFinding[] = [];
        for (const fn of [probeLlmPromptInjection, probeLlmMemoryPoisoning, probeLlmInsecureToolUse]) {
          const f = await fn(discovered, origin, headers);
          if (f) all.push(f as RawSeclayerFinding);
        }
        return done(all, "llm-endpoint");
      }
      case "edge_function": {
        const texts = strListArg(args, "texts") ?? [];
        if (texts.length === 0) return deny("seclayer_dast edge_function needs texts (page/JS content) to mine for edge-function URLs.");
        const finding = await probeEdgeFunctionAuth(texts, headers);
        return done(finding ? [finding] : [], "edge-function");
      }
      case "i18n": {
        const findings = await probeI18nAuthBypass(url, strListArg(args, "paths") ?? [], headers);
        return done(findings as RawSeclayerFinding[], "i18n-auth-bypass");
      }
      case "weak_session": {
        const lt = args["loginTarget"];
        const loginTarget = lt && typeof lt === "object" && !Array.isArray(lt) ? (lt as Record<string, unknown>) : undefined;
        const username = strArg(args, "username");
        const password = strArg(args, "password");
        if (!loginTarget || !username || !password) {
          return deny("seclayer_dast weak_session needs loginTarget plus the owner-supplied username/password of a test account.");
        }
        const creds = { username, password };
        const finding = await probeWeakSessionToken(loginTarget as unknown as InjectableTarget, creds, headers);
        return done(finding ? [finding] : [], "weak-session-token");
      }
      default:
        return deny(`seclayer_dast probe must be one of csrf, stored_xss, dom_xss, price_manipulation, prototype_pollution, deserialization, credential_chain, auth_rate_limit, llm, edge_function, i18n, weak_session — got ${JSON.stringify(args["probe"] ?? null)}.`);
    }
  } catch (e) {
    return {
      result: `seclayer_dast/${probe} vs ${url} — engine error, no findings recorded: ${e instanceof Error ? e.message : String(e)}`,
      attackId: pre.attackId,
      target: url,
      ok: false,
    };
  }
}
