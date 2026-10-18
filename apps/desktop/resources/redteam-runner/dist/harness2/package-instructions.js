/** Budget assumed when the operator sets none. */
export const DEFAULT_PROBE_TOKEN_BUDGET = 200_000;
/** Operator override for the per-cycle probe token budget. */
export const PROBE_TOKEN_BUDGET_ENV = "DSH_HARNESS2_PROBE_TOKEN_BUDGET";
/** The reply syntax the editor must use; parsed by ./package-reply.ts. */
export const REPLY_FORMAT_DOC = [
    "Answer with these blocks, in this order, one @@...@@ pair each (loudness of prose outside blocks is ignored):",
    "",
    "@@PROPOSAL <editable-component-id>@@",
    "<one full cordis patch-layer YAML document (the `- insert:` list shape) for exactly one editable component>",
    "@@END-PROPOSAL@@",
    "@@RATIONALE@@",
    "<which contrast pair you used, what you changed and why>",
    "@@END-RATIONALE@@",
    "@@EXPECTED-EFFECT@@",
    "<the metric you expect to move and its expected direction, e.g. `vulnsFound: +1 or more; steps: no increase`>",
    "@@END-EXPECTED-EFFECT@@",
    "@@SUPPORTING-EVIDENCE@@",
    "<the pair index and run ids you relied on, one per block; repeat the block for several pieces of evidence>",
    "@@END-SUPPORTING-EVIDENCE@@",
    "@@FILE <repo-relative path>@@",
    "<the FULL file content, verbatim: never a diff, patch or hunk>",
    "@@END-FILE@@",
    "",
    "Rules enforced by the parser: exactly one @@PROPOSAL block; at least one @@SUPPORTING-EVIDENCE and one @@FILE block; @@FILE bodies are full files (a unified diff is rejected); any block naming a pinned guardrail (src/safety, src/policy, auth-gate) is AUTO-REJECTED and FLAGGED; k=1 means one proposal and one probe per cycle.",
].join("\n");
/** Read the per-cycle probe token budget (operator override wins; must be positive). */
export function resolveProbeTokenBudget(environment = process.env) {
    const raw = environment[PROBE_TOKEN_BUDGET_ENV]?.trim();
    if (raw === undefined || raw === "")
        return DEFAULT_PROBE_TOKEN_BUDGET;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : DEFAULT_PROBE_TOKEN_BUDGET;
}
/** Build the section-6 constraint block for one package. */
export function buildConstraints(guardrailPaths, environment = process.env) {
    return {
        guardrailsPinned: true,
        guardrails: guardrailPaths,
        k: 1,
        proposeOnly: true,
        probeTokenBudget: resolveProbeTokenBudget(environment),
    };
}
/** Render section 6 (constraints restated + the required reply format). */
export function renderConstraintsSection(constraints) {
    const budget = constraints.probeTokenBudget;
    return [
        "## Constraints (restated)",
        "",
        `guardrails_pinned: ${String(constraints.guardrailsPinned)}`,
        `guardrail_paths: ${constraints.guardrails.length} (listed with path + sha256 + PINNED marker in section 2; no contents are shipped)`,
        `k: ${constraints.k}`,
        `propose_only: ${String(constraints.proposeOnly)}`,
        `probe_token_budget: ${budget}`,
        "",
        "- Guardrails are PINNED: every guardrail file is listed in section 2 by path and content hash with the marker",
        '  "PINNED - DO NOT PROPOSE CHANGES". Any proposal touching src/safety, src/policy or auth-gate is auto-rejected and flagged.',
        "- k = 1: one proposal per cycle and one probe per proposal; there is no internal search over variants.",
        "- Propose-only: the tuner never adopts a layer from this package; a human operator must approve after an offline probe.",
        `- Probe token budget for this cycle: ${budget} tokens. A proposal whose probe would exceed it is not run this cycle.`,
        "- No new dependencies; additive layers only; no destructive actions; never rewrite or delete the base layer.",
        "",
        "## Required editor reply format (section 10)",
        "",
        REPLY_FORMAT_DOC,
    ];
}
//# sourceMappingURL=package-instructions.js.map