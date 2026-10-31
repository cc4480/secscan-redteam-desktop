/**
 * Harness2 cherry-pick: shared contract.
 *
 * Every part of the harness-optimization subsystem codes against this module.
 * The decomposition mirrors Harness2's eight editable harness components, but
 * the red-team guardrail component is pinned and can never appear in a proposal.
 */
import { join } from "node:path";
/** The eight harness components from Harness2, with dsh's implementation names. */
export const HARNESS_COMPONENTS = {
    systemPrompt: 'system-prompt',
    guardrails: 'guardrails',
    memory: 'memory',
    toolGuidance: 'tool-guidance',
    subagents: 'subagents',
    skills: 'skills',
    scripts: 'scripts',
    plugins: 'plugins',
};
/** Components a proposal may target. Guardrails are permanently excluded. */
export const EDITABLE_COMPONENTS = [
    HARNESS_COMPONENTS.systemPrompt,
    HARNESS_COMPONENTS.memory,
    HARNESS_COMPONENTS.toolGuidance,
    HARNESS_COMPONENTS.subagents,
    HARNESS_COMPONENTS.skills,
    HARNESS_COMPONENTS.scripts,
    HARNESS_COMPONENTS.plugins,
];
/** Component that is pinned: any proposal touching it is auto-rejected and flagged. */
export const PINNED_COMPONENT = HARNESS_COMPONENTS.guardrails;
/** Where the subsystem keeps its state; overridable for tests. */
export function resolveHarness2Paths(environment = process.env) {
    const root = environment.DSH_HARNESS2_ROOT?.trim() !== undefined && environment.DSH_HARNESS2_ROOT.trim() !== ''
        ? environment.DSH_HARNESS2_ROOT.trim()
        : 'E:\\secscan-harness2';
    return {
        root,
        database: join(root, "harness2.db"),
        layers: join(root, "layers"),
        experience: join(root, "experience"),
        runs: join(root, "runs"),
    };
}
//# sourceMappingURL=contract.js.map