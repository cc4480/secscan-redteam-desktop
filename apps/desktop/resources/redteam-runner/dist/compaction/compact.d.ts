/**
 * Context compaction (PentAGI alignment A3 Deep — Carlos, 2026-10-27:
 * full compaction, not the phase-handoff minimum).
 *
 * agentLoop's message history otherwise grows for the whole run, bounded
 * only by turn caps. When the chain exceeds its byte budget, the middle
 * of the history — everything except the system prompt, the engagement
 * objective, and the most recent raw turns — is replaced by ONE summary
 * message produced through the engagement's own completion seam and
 * cached by slice hash (summary-cache.ts), so identical evidence is
 * never re-summarized. Earlier summaries are themselves compactable, so
 * a long run compresses in waves.
 *
 * Recall discipline: the summarizer is instructed to preserve every
 * load-bearing fact verbatim (targets, finding ids and statuses,
 * evidence digests, refusals, open leads), and findings also live
 * outside the history — the shared-state digest rides every tool
 * result and ctx state is never compacted. Compaction is failure-
 * isolated: any error leaves the history untouched and the loop runs
 * on uncompacted, exactly as it did before A3.
 */
import type { AgentRole, ChatMessage } from '@secscan/redteam-llm-router';
import type { Ctx } from '../context.js';
import type { LlmTokenUsage } from '../harness2/trajectory-normalize.js';
import type { EngagementPhase } from '../types.js';
import { SummaryCache } from './summary-cache.js';
export declare const DEFAULT_BUDGET_CHARS = 96000;
export declare const DEFAULT_PRESERVE_LAST = 6;
export declare const SUMMARY_MARKER = "[COMPACTED HISTORY";
/** Summarize one rendered transcript slice; returns the summary text. */
export type Summarizer = (sliceText: string) => Promise<string>;
export interface CompactionResult {
    readonly beforeChars: number;
    readonly afterChars: number;
    /** Messages replaced by the summary message. */
    readonly compactedCount: number;
    /** Compaction passes run (a deep history can need more than one). */
    readonly passes: number;
    readonly cacheHits: number;
    readonly cacheMisses: number;
}
/** Approximate chain size: content bytes plus any tool-call payloads. */
export declare function estimateChars(messages: readonly ChatMessage[]): number;
/** Build the production summarizer over the engagement's completion seam. */
export declare function makeSummarizer(complete: (role: AgentRole, messages: ChatMessage[], opts: {
    tools: never[];
}) => Promise<{
    text: string;
    usage?: LlmTokenUsage;
}>, role: AgentRole, onUsage?: (usage: LlmTokenUsage | undefined) => void): Summarizer;
export interface CompactOptions {
    readonly budgetChars?: number;
    readonly preserveLast?: number;
    readonly cache?: SummaryCache;
}
/**
 * Compact `messages` in place until it fits the budget or nothing more
 * can be compacted. Returns null when no compaction was needed or
 * possible. Never throws — the caller treats null as "run as-is".
 */
export declare function compactMessages(messages: ChatMessage[], summarize: Summarizer, opts?: CompactOptions): Promise<CompactionResult | null>;
/**
 * The agentLoop seam: compact before a completion when the chain is over
 * budget. Configuration is data — REDTEAM_COMPACTION=0 disables,
 * REDTEAM_COMPACTION_BUDGET_CHARS and REDTEAM_COMPACTION_PRESERVE_LAST
 * override the defaults. Failure-isolated: logs and returns on any error.
 */
export declare function maybeCompactMessages(ctx: Ctx, role: AgentRole, phase: EngagementPhase, messages: ChatMessage[], complete: Parameters<typeof makeSummarizer>[0], onUsage?: (usage: LlmTokenUsage | undefined) => void): Promise<CompactionResult | null>;
