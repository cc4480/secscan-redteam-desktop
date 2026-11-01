/**
 * The fleet surface's seam to Builder A's bridge client (src/bridge).
 *
 * B consumes A structurally through {@link BridgeClientLike} so the fleet
 * wiring never imports src/bridge at compile time: tests inject fakes
 * through `ctx.deps.bridgeClient` or a handler argument, and the default
 * client is built lazily by dynamic import on first use. Until A's module
 * is importable — or whenever the bridge is absent — resolution degrades
 * to an always-unavailable client, because bridge absence is a normal
 * state, never an error (the Seclayer-key doctrine).
 *
 * FULL SURFACE (Carlos's direct order, 2026-10-31 ~18:00 CDT, relayed
 * by the coordinator): there is no allowlist and no name filtering
 * anywhere in the fleet wiring — every tool the bridge offers is
 * offered and callable. A's client (landed 65cb1fde) exposes the full
 * registry; this wrapper passes it through unchanged, normalizing
 * result shapes and classifying errors. The only gate is bridge
 * availability (dispatch/bridge-gate.ts).
 */
import type { Ctx } from "../context.js";
/** One tool as A's client reports it (the MCP tools/list shape). */
export interface BridgeToolInfo {
    /** Bridge op name, unprefixed (e.g. "cdp_navigate"). */
    name: string;
    /** The bridge's own description, when it sent one. */
    description?: string;
    /** MCP input schema (A's field name). */
    inputSchema?: unknown;
    /** Alternate schema field name some MCP servers use. */
    parameters?: unknown;
}
/** The honest failure states a bridge call can end in. */
export type BridgeErrorKind = "unavailable" | "bridge-denied" | "bridge-error";
/** A classified bridge failure; `kind` is what callers branch on. */
export declare class BridgeCallError extends Error {
    readonly kind: BridgeErrorKind;
    constructor(kind: BridgeErrorKind, message: string);
}
/**
 * The structural shape B consumes from a bridge client. A's real client
 * returns richer results ({@link wrapBridgeClient} normalizes them); the
 * fleet only ever needs text back.
 */
export interface BridgeClientLike {
    /** Whether a paired bridge answers on this machine right now. Never throws. */
    available(): Promise<boolean>;
    /**
     * Every tool the bridge offers — the full registry, unfiltered.
     * @throws {BridgeCallError} unavailable / bridge-error.
     */
    listTools(): Promise<BridgeToolInfo[]>;
    /**
     * Call any tool the bridge offers; resolves with the result as text.
     * @throws {BridgeCallError} with the kind naming the failed state.
     */
    call(name: string, args: Record<string, unknown>): Promise<string>;
}
/** The client every seam falls back to: the bridge is simply not there. */
export declare const UNAVAILABLE_BRIDGE_CLIENT: BridgeClientLike;
/**
 * Normalize a raw client (A's, or a test's raw fake) into the shape B
 * consumes: results flattened to text, failures classified into
 * {@link BridgeErrorKind}. No filtering — the full registry passes
 * through (Carlos's order, 2026-10-31).
 */
export declare function wrapBridgeClient(raw: {
    available(): Promise<boolean>;
    listTools(): Promise<readonly BridgeToolInfo[]>;
    call(name: string, args: Record<string, unknown>): Promise<unknown>;
}): BridgeClientLike;
/**
 * Resolve the bridge client for an engagement: the injected test seam
 * when present, otherwise the lazily-built default (A's client behind
 * the normalizing wrapper, or the always-unavailable fallback).
 */
export declare function resolveBridgeClient(ctx: Ctx): Promise<BridgeClientLike>;
