/**
 * API route — Foundry (D2 surface: API endpoints for the chat view).
 *
 * GET  /api/foundry        snapshot bundles + tiers, the app-data
 *                                  store's scan-created cases, and Gold
 *                                  Loop state, each with its source named.
 * POST /api/foundry/verify run the located gate CLI's verify over
 *                                  the frozen snapshot; per-family results.
 * POST /api/foundry/run-gold
 *                                  run the gate over the GOLD bundles;
 *                                  per-family panel/score results.
 * POST /api/foundry/loop   run one Gold Loop cycle over the store.
 *
 * Honest absence is a feature: when no snapshot or gate CLI is locatable,
 * the response says so and lists every location that was searched. Gate
 * runs spawn node with an argument array only — the snapshot path comes
 * from discovery and slugs from the manifest, never from the request.
 */
import type { ServerResponse } from 'node:http';
import { type FoundryBundleRow } from '../../foundry/locate.js';
import type { UiStore } from '../store.js';
/**
 * Handle GET /api/foundry.
 *
 * @param store - the UI store (its engagements dir anchors the store path)
 * @param res - the HTTP response to write
 * @returns nothing; the response is written to res
 */
export declare function handleFoundry(store: UiStore, res: ServerResponse): void;
/**
 * Handle POST /api/foundry/verify.
 *
 * @param _store - unused; kept for route-signature symmetry
 * @param res - the HTTP response to write
 * @returns nothing; the response is written to res
 */
export declare function handleFoundryVerify(_store: UiStore, res: ServerResponse): Promise<void>;
/**
 * Handle POST /api/foundry/run-gold.
 *
 * @param _store - unused; kept for route-signature symmetry
 * @param res - the HTTP response to write
 * @returns nothing; the response is written to res
 */
export declare function handleFoundryRunGold(_store: UiStore, res: ServerResponse): Promise<void>;
/**
 * Handle POST /api/foundry/loop — one Gold Loop cycle over the
 * app-data store.
 *
 * @param store - the UI store (its engagements dir anchors the store path)
 * @param res - the HTTP response to write
 * @returns nothing; the response is written to res
 */
export declare function handleFoundryLoop(store: UiStore, res: ServerResponse): Promise<void>;
export type { FoundryBundleRow };
