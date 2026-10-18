/**
 * Public API of the live engagement runner.
 *
 * ```ts
 * import { runEngagement } from "@secscan/redteam-runner";
 * const result = await runEngagement({
 *   target: "secscan.us",
 *   mode: "red",
 *   objective: "assess the external attack surface",
 *   roe: { scope: ["secscan.us"] },
 * });
 * ```
 *
 * Credentials come from the environment (Secure Vault), never from code:
 *   SECSCAN_MCP_TOKEN, DEEPSEEK_API_KEY, QWEN_API_KEY (optional since v0.6 —
 *   DeepSeek-only policy), SECSCAN_MCP_URL (optional).
 *
 * Console bridge: the console's "start engagement" action writes an
 * EngagementInput JSON file into the queue dir; `watchQueue()` picks it up
 * and runs it. Engagement state streams to
 * <engagementsDir>/<id>/{events.jsonl,state.json,engagement.md,report.md}.
 */
import { readEvents, readState, type LiveState } from "./events.js";
import { type RunOptions } from "./phases.js";
import type { EngagementInput } from "./types.js";
export { runEngagement, resolveConfig } from "./phases.js";
export type { RunOptions } from "./phases.js";
export type { RunnerDeps } from "./context.js";
export type { EngagementEvent, EngagementInput, EngagementMode, EngagementPhase, EngagementResult, EngagementStatus, Finding, OperationPlan, PlanStep, BlackoutWindow, RulesOfEngagement, RunnerOptions, } from "./types.js";
export type { LiveState };
export { readEvents, readState };
export { TECHNIQUES, lookupTechnique, defaultExcludedForMode, resolveExcludedTechniques, ALWAYS_EXCLUDED } from "./attack.js";
export { BATTERY, BATTERY_CATEGORIES, CATEGORY_LABELS, batteryChecklistText, batteryItemsFor, lookupBatteryItem, } from "./battery.js";
export type { BatteryCategory, BatteryItem } from "./battery.js";
export { scopeHosts, urlInScope, inBlackout, inTestWindow, techniqueAllowed, checkAuthorization, checkScopeAuthorization } from "./gate.js";
export type { CheckAuthorizationOptions } from "./gate.js";
export { isPrivateOrLoopbackHost, validateProbeTarget } from "./prober.js";
export type { ValidateProbeTargetOptions } from "./prober.js";
export { COMPLIANCE_CONTROLS, METHODOLOGY_EXCLUSIONS, METHODOLOGY_TOOLS, TECHNIQUE_CONTROL_MAP, allBatteryAttackIds, buildCompliancePack, buildRetestEvidence, controlsForTechnique, invalidMappedControlIds, lookupControl, renderAttestationLetter, renderCompliancePackMarkdown, unmappedBatteryTechniques, } from "./compliance/index.js";
export type { AttestationInput, ComplianceControl, ComplianceFramework, CompliancePack, CompliancePackInput, PackFinding, RetestEntry, RetestObservation, TechniqueControlMapping, } from "./compliance/index.js";
export { TargetRateLimiter, TargetAutoHalt, buildSafetyManifest, renderSafetyManifestMarkdown, buildZeroDisruptionRecord, disruptionVerdict, redactPii, piiPatternLabels, parseEnvironment, productionConfirmed, requireGraduation, resolveEffectiveRps, isTargetDistress, PROTECTIONS_IN_FORCE, RESIDUAL_RISKS, SAFETY_MANIFEST_VERSION, } from "./safety/index.js";
export type { SafetyManifest, ManifestInputs, ZeroDisruptionRecord, RateLimitConfig, AutoHaltConfig, TestEnvironment, } from "./safety/index.js";
export { loadWatchProfile, checkScopeFresh, profileHome, alertSeverities, emptyBaseline, loadBaseline, saveBaseline, findingKey, bundlePathFor, classifyDrift, resolveMissingDrift, buildDriftReport, applyDriftToBaseline, touchBaselineEntries, remediateBaselineEntries, flagBaselineNeedsReview, renderDriftMarkdown, runWatchCycle, watchLoop, WATCH_PROFILE_VERSION, BASELINE_VERSION, } from "./continuous/index.js";
export type { WatchProfile, WatchCadence, AlertSeverity, BaselineEntry, BaselineEntryStatus, WatchBaseline, DriftDisposition, DriftMissing, DriftClassification, DriftReport, ReverifyFn, WatchCycleOptions, WatchCycleStatus, WatchCycleResult, } from "./continuous/index.js";
export interface QueueJob {
    /** Path of the job file (for completion bookkeeping). */
    jobFile: string;
    input: EngagementInput;
}
/** Write a queue job (what the console's start-engagement action does). */
export declare function enqueueEngagement(input: EngagementInput, queueDir?: string): string;
/**
 * Validate a queue-dropped job file at intake (v0.28.0). Mirrors the checks
 * cli/args.ts buildInput() and the UI launch route enforce, so a malformed
 * job fails fast at the queue — naming the file and the reason — instead
 * of dying deep inside runEngagement. Throws on the first problem found.
 */
export declare function validateQueueInput(raw: unknown): EngagementInput;
/**
 * Watch the queue dir and run engagements as they arrive. Long-running;
 * resolve only on abort. Each job file is moved to <queue>/done/ afterwards.
 */
export declare function watchQueue(queueDir?: string, opts?: RunOptions, pollMs?: number, signal?: AbortSignal): Promise<void>;
