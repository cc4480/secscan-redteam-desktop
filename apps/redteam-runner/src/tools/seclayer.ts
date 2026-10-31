/**
 * Native Seclayer module tool definitions.
 *
 * The Seclayer non-repeat modules are embedded in the runner
 * (src/seclayer/, a byte-frozen vendored copy) and run in-process
 * through these tools — no MCP server, no service call. Every tool
 * here fires ACTIVE web app tests (real exploit attempts, fuzzing, or
 * authenticated two-identity probes), so every one of them is
 * VERIFICATION-GATED: the runner refuses the call unless owner
 * verification is on the engagement record (the authorize phase
 * records it after the owner proves the target is theirs). The tool
 * descriptions state that requirement because the fleet's logic is
 * where the requirement lives — an agent planning to use these tools
 * must secure verification from the owner first, then proceed.
 *
 * Grouping follows the modules' own structure: the RED_TEAM barrel
 * (redTeamProbes.ts) is one tool; BOLA and the API_SEC flow are one
 * tool each (the flow embeds BOLA when identities are supplied); the
 * webhook signature probe, the DAST-unique probe family (selected by
 * `probe`), and the aggressive set (selected by `probe`) round it out.
 */
import type { JsonSchemaTool } from "@secscan/redteam-llm-router";

const GATE =
  "VERIFICATION-GATED: this tool runs active web app tests and requires owner verification on the engagement record — the runner REFUSES it when no verification is on record, so get verification from the owner that the target is theirs (the authorize phase records it) before calling it. ";

const COMMON: Record<string, unknown> = {
  url: { type: "string", description: "The ONE in-scope target root URL." },
  headers: { type: "object", description: "Optional base request headers (e.g. an authenticated session's Cookie/Authorization) as a JSON object of string values." },
  attackId: { type: "string" },
  category: { type: "string", enum: ["logic", "functionality", "validation"] },
  targetProfile: { type: "string", enum: ["secscan", "seclayer", "webapp", "windows", "linux"] },
  hypothesis: { type: "string" },
};

const IDENTITY_PROPS: Record<string, unknown> = {
  aAuthHeader: { type: "string", description: "Identity A's credential, as a full header value (e.g. 'Bearer …' or 'Cookie: …')." },
  aOwnResource: { type: "string", description: "Path/URL of an object identity A owns (e.g. '/api/v1/orders/1001')." },
  aOwnMarker: { type: "string", description: "Optional value unique to A's data (e.g. A's email) — sharpens the proof." },
  bAuthHeader: { type: "string", description: "Identity B's credential, as a full header value." },
  bOwnResource: { type: "string", description: "Path/URL of an object identity B owns." },
  bOwnMarker: { type: "string", description: "Optional value unique to B's data." },
};

export const SECLAYER_REDTEAM_TOOL: JsonSchemaTool = {
  name: "seclayer_redteam",
  description:
    GATE +
    "Run the embedded Seclayer RED_TEAM probe set against ONE in-scope root URL: real exploit attempts for SQL injection, reflected XSS, OS command injection, reflected SSRF, and blind (out-of-band) SSRF. Each hit returns a PROVEN-grade receipt (the signal is a literal substring of the captured response); a probe that cannot prove its technique returns nothing. Blind SSRF no-ops unless a collaborator is configured in-process (it is not, in this build). " +
    "Include attackId (a real ATT&CK ID such as 'T1190'), category, targetProfile ('seclayer' for the Seclayer battery, 'webapp' for a client web application), and a one-sentence hypothesis.",
  parameters: { type: "object", properties: { ...COMMON }, required: ["url", "category"] },
};

export const SECLAYER_BOLA_TOOL: JsonSchemaTool = {
  name: "seclayer_bola",
  description:
    GATE +
    "Run the embedded Seclayer two-identity BOLA/IDOR probe: given two owned test identities A and B, it proves (or disproves) that A can read B's object. A PROVEN result requires all three legs — A reads its own object, A reads B's object and gets B's data back, and an unauthenticated request to the same object is denied; anything less is reported at a lower confidence, never as confirmed BOLA. Supply both identities' auth headers and owned-resource paths. " +
    "Include attackId, category, targetProfile, and a one-sentence hypothesis.",
  parameters: { type: "object", properties: { ...COMMON, ...IDENTITY_PROPS }, required: ["url", "category", "aAuthHeader", "aOwnResource", "bAuthHeader", "bOwnResource"] },
};

export const SECLAYER_API_TOOL: JsonSchemaTool = {
  name: "seclayer_api",
  description:
    GATE +
    "Run the embedded Seclayer API_SEC flow against ONE in-scope API root: GraphQL introspection exposure, GraphQL query-cost/alias-amplification controls, exposed user/credential list detection in API responses, and — when both test identities are supplied (the a*/b* arguments, same as seclayer_bola) — the two-identity BOLA probe as part of the flow. " +
    "Include attackId, category, targetProfile, and a one-sentence hypothesis.",
  parameters: { type: "object", properties: { ...COMMON, ...IDENTITY_PROPS }, required: ["url", "category"] },
};

export const SECLAYER_WEBHOOK_TOOL: JsonSchemaTool = {
  name: "seclayer_webhook",
  description:
    GATE +
    "Run the embedded Seclayer webhook signature-bypass probe against ONE in-scope root URL: it posts deliberately bad-signature webhook deliveries (Stripe-style and Svix-style endpoints among the candidate paths, plus any discovered POST URLs you pass in postUrls) and proves a bypass only when the endpoint accepts a forged signature it should have rejected. " +
    "Include attackId, category, targetProfile, and a one-sentence hypothesis.",
  parameters: {
    type: "object",
    properties: { ...COMMON, postUrls: { type: "array", items: { type: "string" }, description: "Discovered POST endpoint URLs to add to the built-in candidate paths." } },
    required: ["url", "category"],
  },
};

export const SECLAYER_DAST_TOOL: JsonSchemaTool = {
  name: "seclayer_dast",
  description:
    GATE +
    "Run ONE embedded Seclayer DAST-unique probe, selected by `probe`: csrf (tokenless-form + SameSite=None posture, from cookieLines + forms you captured), stored_xss (payload persistence through discovered formTargets), dom_xss (DOM sink execution — needs headless rendering enabled in-process; a clean no-op otherwise), price_manipulation (checkout total tampering via postUrls), prototype_pollution (JSON __proto__ gadget via postUrls), deserialization (serialized-object markers in cookieLines), credential_chain (exposed backend key pairs — pass pageText to extract from, or pairs directly), auth_rate_limit (credential-verification endpoints accepting unlimited attempts, via postUrls), llm (prompt-injection / memory-poisoning / insecure-tool-use probes against discovered LLM endpoints), edge_function (auth differentials on edge-function URLs found in texts), i18n (locale-prefix auth bypass: /en gated but /es not, over discovered paths), weak_session (log in ONCE with the owner-supplied credentials at loginTarget and test the issued session token for predictability). " +
    "Supply the discovery inputs the selected probe needs (formTargets / postUrls / cookieLines / forms / texts / paths / pairs / pageText / discovered / loginTarget + username + password). Include attackId, category, targetProfile, and a one-sentence hypothesis.",
  parameters: {
    type: "object",
    properties: {
      ...COMMON,
      probe: {
        type: "string",
        enum: ["csrf", "stored_xss", "dom_xss", "price_manipulation", "prototype_pollution", "deserialization", "credential_chain", "auth_rate_limit", "llm", "edge_function", "i18n", "weak_session"],
      },
      postUrls: { type: "array", items: { type: "string" } },
      formTargets: { type: "array", items: { type: "object" }, description: "Discovered injectable targets: {url, method, params[], source, contentType?, discoveredOnPage?}." },
      cookieLines: { type: "array", items: { type: "string" }, description: "Raw Set-Cookie lines captured from the target." },
      forms: { type: "array", items: { type: "object" }, description: "Captured forms for the csrf probe: {url, method, params[]}." },
      texts: { type: "array", items: { type: "string" }, description: "Page/JS texts to mine for edge-function URLs (edge_function probe)." },
      paths: { type: "array", items: { type: "string" }, description: "Discovered paths (i18n probe)." },
      pageText: { type: "string", description: "Page/JS text to extract exposed key pairs from (credential_chain probe)." },
      pairs: { type: "array", items: { type: "object" }, description: "Pre-extracted key pairs: {prefix, url, key} (credential_chain probe)." },
      discovered: { type: "array", items: { type: "object" }, description: "Discovered endpoints for the llm probe: {url, method?, params?}." },
      loginTarget: { type: "object", description: "The login form target for weak_session: {url, method, params[], source, contentType?}." },
      username: { type: "string" },
      password: { type: "string" },
    },
    required: ["url", "category", "probe"],
  },
};

export const SECLAYER_AGGRESSIVE_TOOL: JsonSchemaTool = {
  name: "seclayer_aggressive",
  description:
    GATE +
    "Run ONE embedded Seclayer aggressive probe, selected by `probe`, against ONE in-scope root URL: ssti (server-side template injection), nosql (NoSQL operator injection), xxe (XML external entity — out-of-band receipt when a collaborator is configured, differential otherwise), crlf (CRLF / response-splitting injection), host_header (host-header injection / password-reset poisoning). Each returns a finding only when it proves the technique. " +
    "Include attackId, category, targetProfile, and a one-sentence hypothesis.",
  parameters: {
    type: "object",
    properties: { ...COMMON, probe: { type: "string", enum: ["ssti", "nosql", "xxe", "crlf", "host_header"] } },
    required: ["url", "category", "probe"],
  },
};

export const SECLAYER_TOOLS: JsonSchemaTool[] = [
  SECLAYER_REDTEAM_TOOL,
  SECLAYER_BOLA_TOOL,
  SECLAYER_API_TOOL,
  SECLAYER_WEBHOOK_TOOL,
  SECLAYER_DAST_TOOL,
  SECLAYER_AGGRESSIVE_TOOL,
];
