/**
 * Coverage + compliance views (v0.22.0).
 *
 * GET /api/engagements/:id/coverage — per-item verdict counts from
 * item-verdicts.json plus the cell summary from state.json.
 * GET /api/engagements/:id/compliance — compliance pack, attestation, and
 * safety manifest rendered to sanitized HTML.
 */
import type { ServerResponse } from "node:http";
import type { UiStore } from "../store.js";
/** GET /api/engagements/:id/coverage */
export declare function handleCoverage(store: UiStore, res: ServerResponse, id: string): void;
/** GET /api/engagements/:id/compliance */
export declare function handleCompliance(store: UiStore, res: ServerResponse, id: string): void;
