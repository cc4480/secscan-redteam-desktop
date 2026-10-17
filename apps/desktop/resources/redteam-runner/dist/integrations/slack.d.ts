/**
 * INTEGRATIONS — Slack sink (v0.15.0).
 *
 * Engagement lifecycle notifications via incoming webhook: started, phase
 * transitions, completed (with severity counts), and critical-finding
 * alerts. Best-effort by design — a failed notification is logged and
 * never breaks the engagement.
 */
import type { SlackConfig } from "./config.js";
import { type HttpFn } from "./http.js";
export type SlackEventKind = "started" | "phase" | "completed" | "critical_finding" | "halted" | "drift";
export interface SlackEvent {
    kind: SlackEventKind;
    engagementId: string;
    target: string;
    mode: string;
    /** Phase name for "phase" events. */
    phase?: string;
    /** Severity counts for "completed" events. */
    severityCounts?: Record<string, number>;
    /** Finding title for "critical_finding" events. */
    findingTitle?: string;
    findingId?: string;
    /** Reason for "halted" events. */
    reason?: string;
    /** v0.16.0 continuous drift summary for "drift" events. */
    drift?: {
        newCount: number;
        remediatedCount: number;
        reopenedCount: number;
        needsReviewCount: number;
        changeRef?: string;
        topNew: Array<{
            id: string;
            severity: string;
            title: string;
        }>;
    };
}
export declare function buildSlackPayload(ev: SlackEvent): {
    text: string;
    blocks: unknown[];
};
/** Fire-and-forget shape: throws on failure so callers can log it. */
export declare function notifySlack(cfg: SlackConfig, ev: SlackEvent, http?: HttpFn): Promise<void>;
