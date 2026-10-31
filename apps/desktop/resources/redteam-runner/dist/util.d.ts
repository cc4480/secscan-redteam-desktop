/**
 * Shared tiny utilities (v0.19.0 refactor).
 *
 * sleep: black-mode jitter + blackout waits.
 * extractJsonBlock: pull a fenced (or bare) JSON block out of model output.
 * Both are pure, dependency-free, and used across dispatcher/agents/report.
 */
export declare const sleep: (ms: number) => Promise<unknown>;
/** Generate a fresh engagement id, or validate an operator-supplied one. */
export declare function safeEngagementId(candidate?: string): string;
export declare function extractJsonBlock(text: string): unknown | null;
