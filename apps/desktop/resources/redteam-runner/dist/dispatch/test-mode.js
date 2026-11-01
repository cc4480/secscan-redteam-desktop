/** True when this engagement runs under TEST MODE. */
export function testModeOn(ctx) {
    return ctx.config?.testMode === true;
}
/** Append the per-call receipt for a gate bypassed under TEST MODE. */
export function noteTestModeBypass(ctx, phase, target, what) {
    ctx.events.append({
        phase,
        actor: "runner",
        action: "test_mode_bypass",
        ...(target ? { target } : {}),
        result: `TEST MODE bypass: ${what}`,
    });
}
//# sourceMappingURL=test-mode.js.map