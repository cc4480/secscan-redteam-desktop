/**
 * Authoritative manifest of distinct native Seclayer test identities.
 *
 * "Test identity" here means a distinct probe/check class executed by one of the
 * 6 native Seclayer tools (`seclayer_redteam`, `seclayer_bola`, `seclayer_api`,
 * `seclayer_webhook`, `seclayer_dast`, `seclayer_aggressive`) — not the A/B auth
 * identities used for BOLA (`BolaIdentity`).
 *
 * Counting rules (evidence-based, reconciled against Blueprint Item 10):
 * - Count each distinct probe/check implementation that a tool executes as one
 *   identity, even if conditionally not-run for a target (e.g. blind/OOB probes
 *   on remote targets are still suite identities; dispatch reports them not-run).
 * - Count `seclayer_dast` `llm` fan-out as three distinct executed subprobes:
 *   prompt injection, memory poisoning, and insecure tool use.
 * - Count the two-identity BOLA/IDOR probe once even though it is invocable via
 *   both `seclayer_bola` and `seclayer_api` (same probe identity/implementation).
 * - Exclude utility capture analyzers not executed by the 6 tools (e.g.
 *   `exposedUserListInCapture` / `exposedCredentialListInCapture` in
 *   `apiProbes.ts` are exported but not invoked by tool dispatch paths).
 *
 * Blueprint Item 10 states "36 distinct test identities"; the enumerated native
 * runner suite identities provided by these 6 tools total 29. This manifest is the
 * source of truth for the implemented suite and should be updated if probes are
 * added/removed/rewired.
 */
export const SECLAYER_TEST_IDENTITIES = [
    // seclayer_redteam — runRedTeamProbes (server/redTeamProbes.ts PROBES)
    {
        id: "redteam.sql_injection",
        name: "SQL injection",
        tools: ["seclayer_redteam"],
        family: "redteam",
        probe: "server/redTeam/sqlInjection.ts#probeSqlInjection",
    },
    {
        id: "redteam.reflected_xss",
        name: "Reflected XSS",
        tools: ["seclayer_redteam"],
        family: "redteam",
        probe: "server/redTeam/reflectedXss.ts#probeReflectedXss",
    },
    {
        id: "redteam.command_injection",
        name: "OS command injection",
        tools: ["seclayer_redteam"],
        family: "redteam",
        probe: "server/redTeam/commandInjection.ts#probeCommandInjection",
    },
    {
        id: "redteam.reflected_ssrf",
        name: "SSRF (reflected)",
        tools: ["seclayer_redteam"],
        family: "redteam",
        probe: "server/redTeam/ssrf.ts#probeSsrf",
    },
    {
        id: "redteam.blind_ssrf_oob",
        name: "Blind SSRF (out-of-band)",
        tools: ["seclayer_redteam"],
        family: "redteam",
        probe: "server/redTeam/blindSsrf.ts#probeBlindSsrf",
        note: "Distinct OOB identity; reported not-run/unverifiable for non-loopback targets in this build.",
    },
    // seclayer_bola / seclayer_api (shared probe identity)
    {
        id: "bola.two_identity_idor",
        name: "Two-identity BOLA/IDOR",
        tools: ["seclayer_bola", "seclayer_api"],
        family: "bola",
        probe: "server/bola.ts#bolaProbe",
        note: "Exposed as seclayer_bola and as part of seclayer_api when both test identities are supplied.",
    },
    // seclayer_api — runApiSecProbes (server/apiProbes.ts, API_PROBE_COUNT=4)
    {
        id: "api.graphql_introspection",
        name: "GraphQL schema introspection exposed",
        tools: ["seclayer_api"],
        family: "api",
        probe: "server/apiProbes.ts#runApiSecProbes (GraphQL introspection probe)",
    },
    {
        id: "api.graphql_query_cost",
        name: "GraphQL query-cost/alias amplification controls",
        tools: ["seclayer_api"],
        family: "api",
        probe: "server/apiProbes.ts#runApiSecProbes (query-cost/alias amplification probe)",
    },
    {
        id: "api.exposed_user_object",
        name: "Exposed user object endpoint",
        tools: ["seclayer_api"],
        family: "api",
        probe: "server/apiProbes.ts#runApiSecProbes (fixed-path exposed user-object heuristic)",
    },
    // seclayer_webhook
    {
        id: "webhook.signature_bypass",
        name: "Webhook signature verification bypass (conditional)",
        tools: ["seclayer_webhook"],
        family: "webhook",
        probe: "server/webhookSignatureProbe.ts#probeWebhookSignatureBypass",
    },
    // seclayer_dast — dispatch/seclayer-dast.ts probe routing
    {
        id: "dast.csrf",
        name: "CSRF exposure (SameSite=None session, tokenless form)",
        tools: ["seclayer_dast"],
        family: "dast",
        probe: "server/csrfProbe.ts#assessCsrf",
    },
    {
        id: "dast.stored_xss",
        name: "Stored XSS",
        tools: ["seclayer_dast"],
        family: "dast",
        probe: "server/storedXss.ts#probeStoredXss",
    },
    {
        id: "dast.dom_xss",
        name: "DOM-based XSS",
        tools: ["seclayer_dast"],
        family: "dast",
        probe: "server/domXss.ts#probeDomXss",
    },
    {
        id: "dast.price_manipulation",
        name: "Business-logic price tampering",
        tools: ["seclayer_dast"],
        family: "dast",
        probe: "server/priceManipulationProbe.ts#probePriceManipulation",
    },
    {
        id: "dast.prototype_pollution",
        name: "Server-side prototype pollution",
        tools: ["seclayer_dast"],
        family: "dast",
        probe: "server/prototypePollutionProbe.ts#probePrototypePollution",
    },
    {
        id: "dast.deserialization",
        name: "Insecure deserialization exposure (cookie scan)",
        tools: ["seclayer_dast"],
        family: "dast",
        probe: "server/deserializationScan.ts#scanCookiesForSerialized",
    },
    {
        id: "dast.credential_chain",
        name: "Client-side key / credential chain exposure",
        tools: ["seclayer_dast"],
        family: "dast",
        probe: "server/credentialChainProbe.ts#probeCredentialUrlPairs",
    },
    {
        id: "dast.auth_rate_limit",
        name: "Missing rate limiting on authentication-code verification",
        tools: ["seclayer_dast"],
        family: "dast",
        probe: "server/authRateLimitProbe.ts#probeAuthRateLimit",
    },
    {
        id: "dast.llm.prompt_injection",
        name: "LLM prompt injection",
        tools: ["seclayer_dast"],
        family: "dast",
        probe: "server/llmProbe.ts#probeLlmPromptInjection",
        note: "LLM fan-out subprobe (selected via seclayer_dast probe=llm).",
    },
    {
        id: "dast.llm.memory_poisoning",
        name: "LLM memory poisoning",
        tools: ["seclayer_dast"],
        family: "dast",
        probe: "server/llmProbe.ts#probeLlmMemoryPoisoning",
        note: "LLM fan-out subprobe (selected via seclayer_dast probe=llm).",
    },
    {
        id: "dast.llm.insecure_tool_use",
        name: "LLM insecure tool use (OOB)",
        tools: ["seclayer_dast"],
        family: "dast",
        probe: "server/llmProbe.ts#probeLlmInsecureToolUse",
        note: "LLM fan-out subprobe; OOB callback is loopback-only in this build.",
    },
    {
        id: "dast.edge_function_auth",
        name: "Edge function authorization bypass",
        tools: ["seclayer_dast"],
        family: "dast",
        probe: "server/edgeFunctionProbe.ts#probeEdgeFunctionAuth",
    },
    {
        id: "dast.i18n_auth_bypass",
        name: "Language-route (i18n) auth bypass",
        tools: ["seclayer_dast"],
        family: "dast",
        probe: "server/i18nProbe.ts#probeI18nAuthBypass",
    },
    {
        id: "dast.weak_session_token",
        name: "Predictable session token (weak seed hash)",
        tools: ["seclayer_dast"],
        family: "dast",
        probe: "server/redTeam/weakSessionToken.ts#probeWeakSessionToken",
    },
    // seclayer_aggressive — dispatch/seclayer.ts AGGRESSIVE_PROBES
    {
        id: "aggressive.ssti",
        name: "Server-side template injection (SSTI)",
        tools: ["seclayer_aggressive"],
        family: "aggressive",
        probe: "server/aggressive/ssti.ts#probeSsti",
    },
    {
        id: "aggressive.nosql",
        name: "NoSQL operator injection (auth bypass)",
        tools: ["seclayer_aggressive"],
        family: "aggressive",
        probe: "server/aggressive/nosql.ts#probeNoSql",
    },
    {
        id: "aggressive.xxe_oob",
        name: "XML external entity (XXE, out-of-band)",
        tools: ["seclayer_aggressive"],
        family: "aggressive",
        probe: "server/aggressive/xxe.ts#probeXxe",
        note: "Distinct OOB identity; reported not-run/unverifiable for non-loopback targets in this build.",
    },
    {
        id: "aggressive.crlf_injection",
        name: "CRLF / HTTP response header injection",
        tools: ["seclayer_aggressive"],
        family: "aggressive",
        probe: "server/aggressive/crlfInjection.ts#probeCrlf",
    },
    {
        id: "aggressive.host_header_injection",
        name: "Host header injection",
        tools: ["seclayer_aggressive"],
        family: "aggressive",
        probe: "server/aggressive/hostHeaderInjection.ts#probeHostHeaderInjection",
    },
];
export const SECLAYER_TEST_IDENTITY_COUNT = SECLAYER_TEST_IDENTITIES.length;
/** Count stated by Blueprint Item 10; see module note for reconciliation. */
export const SECLAYER_BLUEPRINT_IDENTITY_COUNT = 36;
export function getSeclayerTestIdentities() {
    return SECLAYER_TEST_IDENTITIES;
}
