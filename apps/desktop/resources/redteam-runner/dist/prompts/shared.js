/**
 * Shared role-prompt building blocks: PromptContext, the ROE block, the
 * ATT&CK catalog renderer, and the red/black mode briefs. One role prompt
 * per sibling file.
 */
import { TECHNIQUES } from "../attack.js";
import { resolveExcludedTechniques } from "../attack.js";
import { TARGET_PREFIXES, TARGET_PROFILES } from "../targets.js";
/** "SecScan (SS-*) + Windows host + AD (WS-*)" style list for prompt text. */
export function targetListText(targets) {
    return targets.map((t) => `${TARGET_PROFILES[t].name} (${TARGET_PREFIXES[t]}-*)`).join(" + ");
}
export function attackCatalog() {
    return TECHNIQUES.map((t) => `- ${t.id} ${t.name} [${t.tactic}, noise:${t.noise}] — ${t.description}`).join("\n");
}
export function roeBlock(ctx) {
    const excluded = resolveExcludedTechniques(ctx.mode, ctx.roe.excludedTechniques);
    const lines = [
        `## Rules of engagement (binding — violating them ends the engagement)`,
        `- Target: ${ctx.target}. In-scope hosts (EXACT — touch nothing else): ${ctx.scopeHosts.join(", ") || "(none — abort)"}`,
        `- Objective: ${ctx.objective}`,
        `- Mode: ${ctx.mode.toUpperCase()}${ctx.mode === "black" ? " (covert-ops tier: stealth-prioritized, black-box, OPSEC-strict, undeclared to blue team)" : " (overt: aggressive breadth)"}`,
        `- Excluded ATT&CK techniques (never use): ${excluded.join(", ")}`,
    ];
    if (ctx.roe.blackoutWindows?.length) {
        lines.push(`- Blackout windows (runner pauses automatically): ${ctx.roe.blackoutWindows.map((w) => `${w.start}-${w.end}${w.tz ? ` ${w.tz}` : ""}`).join(", ")}`);
    }
    if (ctx.roe.stopConditions?.length)
        lines.push(`- Stop conditions: ${ctx.roe.stopConditions.join("; ")}`);
    if (ctx.roe.deconflictionContact)
        lines.push(`- Deconfliction contact: ${ctx.roe.deconflictionContact}`);
    if (ctx.roe.notes)
        lines.push(`- Operator notes: ${ctx.roe.notes}`);
    if (ctx.localSandbox) {
        lines.push(`- LOCAL SANDBOX MODE: this target is your own disposable local infrastructure (loopback, ` +
            `verified by the runner — not a real client). You MAY complete mutations/state changes ` +
            `(finish the race-condition double-spend, actually escalate a role, actually drive the ` +
            `state machine through) that production engagements would stop short of. DoS/resource ` +
            `exhaustion is STILL never allowed, sandbox or not — that stays off regardless of mode.`);
    }
    else {
        lines.push(`- Non-destructive always: no data writes/deletes, no DoS, no resource exhaustion, no credential stuffing, no pivoting outside scoped hosts. Web targets only — no phishing, social engineering, or physical.`);
    }
    return lines.join("\n");
}
export const MODE_BRIEF = {
    red: `You are operating in RED mode (overt red team). Be aggressive and broad:
cover the attack surface quickly, use the active scanner tier, and test
hypotheses directly. Speed and coverage beat stealth. The blue team may be
aware of the engagement.`,
    black: `You are operating in BLACK mode (covert-ops tier). Assume ZERO prior
knowledge of the target (black-box). Prioritize stealth over speed:
- Prefer low-noise techniques; keep request rates low and irregular.
- Encode/mutate payloads to reduce signature footprint (this is defense-evasion
  testing, not hiding from the client — everything is logged).
- The moment you see a detection signal (WAF block, 429, challenge/CAPTCHA
  page, anomalous redirect), STOP that vector, note it as an OPSEC observation,
  and pivot to a quieter one. Do not hammer a defended endpoint.
- You are undeclared to the target's blue team: a detection firing is a
  finding about THEIR defenses, and also your cue to go quieter.
- Never use T1110 (brute force) — excluded in black mode.`,
};
//# sourceMappingURL=shared.js.map