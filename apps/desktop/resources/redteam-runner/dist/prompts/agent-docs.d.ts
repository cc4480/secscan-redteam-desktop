/**
 * Operator-facing agent docs (agents/*.md) rendered from the executing
 * prompt code — the single source of truth for role behavior.
 *
 * The markdown files are NOT hand-maintained: scripts/gen-agent-prompts.mjs
 * writes them from renderAgentMarkdown() below, and
 * runner/test/prompts-drift.test.ts fails loudly if a committed file drifts
 * from what the code renders. Edit behavior in the sibling prompt modules
 * (coordinator.ts, recon.ts, exploiter.ts, reporter.ts, shared.ts), then
 * regenerate; never edit agents/*.md directly, and never use this renderer
 * as a back door to change behavior.
 *
 * The docs render with a canonical, engagement-independent context (RED
 * mode, placeholder objective/target/scope, default ROE posture) so they
 * describe the roles, not any engagement. Live runs substitute the real
 * context — BLACK mode briefs, ROE, target batteries, the sandbox posture —
 * through the same functions.
 */
import type { PromptContext } from './shared.js'
export declare const AGENT_DOC_ROLES: readonly ['coordinator', 'recon', 'exploiter', 'reporter']
export type AgentDocRole = (typeof AGENT_DOC_ROLES)[number]
/**
 * Canonical context used ONLY to render the operator-facing docs: RED mode,
 * placeholder objective/target/scope, default rule-of-engagement posture
 * (mode-default exclusions, no blackout windows, non-sandbox discipline).
 */
export declare function canonicalAgentDocContext(): PromptContext
/** Banner stamped at the top of every generated agents/*.md file. */
export declare const AGENT_DOC_BANNER = '<!--\n  GENERATED FILE \u2014 do not edit by hand.\n  Single source of truth: runner/src/prompts/ (the code the runner executes).\n  Regenerate: npm run build && node scripts/gen-agent-prompts.mjs\n  Drift guard: runner/test/prompts-drift.test.ts fails if this file disagrees\n  with what the code renders.\n-->'
/** The exact bytes agents/<role>.md must contain. */
export declare function renderAgentMarkdown(role: AgentDocRole): string
