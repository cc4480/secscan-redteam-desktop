/**
 * GET /api/models — which model providers the fleet can use right now and
 * which provider/model each role is seated on. Backs the chat view's engine
 * banner so the operator can SEE the active models (e.g. Meta Muse Spark)
 * instead of trusting an env var.
 */
import type { ServerResponse } from 'node:http';
export declare function handleModels(res: ServerResponse): void;
