/**
 * Findings + proof bundles (v0.22.0).
 *
 * GET /api/engagements/:id/findings — confirmed findings from state.json,
 * each flagged with whether a PoC bundle exists.
 * GET /api/engagements/:id/proof/:fid — the PoC bundle JSON (already
 * redacted at build time; secrets never stored in bundles).
 */
import type { ServerResponse } from "node:http";
import type { UiStore } from "../store.js";
/** GET /api/engagements/:id/findings */
export declare function handleFindings(store: UiStore, res: ServerResponse, id: string): void;
/** GET /api/engagements/:id/proof/:fid */
export declare function handleProof(store: UiStore, res: ServerResponse, id: string, fid: string): void;
