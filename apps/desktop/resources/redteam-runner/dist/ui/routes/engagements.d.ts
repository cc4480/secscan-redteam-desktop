/**
 * Engagement routes (v0.22.0): launch, list, detail.
 *
 * Launch calls runEngagement() directly — the same function the CLI calls —
 * with the run detached (no await) so the HTTP request returns immediately.
 * Validation mirrors cli/args.ts buildInput() so the UI can never launch
 * something the CLI would refuse.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { UiStore } from "../store.js";
/** POST /api/engagements — launch. Returns 202 { id }. */
export declare function handleLaunch(store: UiStore, _req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void>;
/** GET /api/engagements — list all (live first, then history). */
export declare function handleList(store: UiStore, res: ServerResponse): void;
/** GET /api/engagements/:id — state snapshot + artifact availability. */
export declare function handleDetail(store: UiStore, res: ServerResponse, id: string): void;
