/**
 * PoC bundle step primitives: tool tiers, marker/CVE/failure patterns,
 * and the mechanical command/replay/validation extractors.
 */
import type { EngagementEvent } from "../../types.js";
export declare const PROOF_TOOL_ACTIONS: Set<string>;
export declare const CVE_RE: RegExp;
export type StepValidation = "marker-echo" | "observation" | "none";
/** Structured replay parameters — redacted but structurally complete. Credentials are NEVER stored; reverify resolves them fresh from env. */
export interface PocReplay {
    tool: string;
    host?: string;
    args: Record<string, string>;
}
export interface PocStep {
    seq: number;
    ts: string;
    tool: string;
    target?: string;
    attackId?: string;
    /** What was executed (redacted command / request summary, from the audit log). */
    command: string;
    /** Redacted outcome summary. */
    result: string;
    /** Validation signal observed in this step. */
    validation: StepValidation;
    /** The canary marker involved, if any. */
    marker?: string;
    /** CVE tagged on the step, if any. */
    cve?: string;
    /** Replay parameters, or null when the step is not mechanically replayable. */
    replay: PocReplay | null;
}
export declare function isFailure(result: string): boolean;
/** Extract the executed command/request from a tool result summary (all formats are runner-generated, so parsing is mechanical). */
export declare function extractCommand(tool: string, result: string): string;
/** Best-effort structured replay parameters from a correlated event. Null = not mechanically replayable (manual retest). */
export declare function extractReplay(tool: string, event: EngagementEvent, command: string): PocReplay | null;
export declare function stepValidation(tool: string, result: string): {
    validation: StepValidation;
    marker?: string;
};
/**
 * Build a PoC bundle for one finding, derived mechanically from the audit
 * log. Returns null (with reason) when the bar is not met — no bundle is
 * ever fabricated.
 */
