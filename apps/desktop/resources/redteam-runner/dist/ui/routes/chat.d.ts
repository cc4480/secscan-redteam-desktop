/**
 * POST /api/chat — one direct chat completion through the router, for the
 * model the operator picked in the chat view. This is the operator's own
 * conversation surface: it is NOT an engagement launch and it never touches
 * the fleet seats (roleModelPolicy is not consulted here).
 *
 * Body: { provider, model, messages: [{ role, content }] }.
 *
 * The local provider is gated on the LIVE local catalog (../local-model.ts):
 * the request is answered only while the desktop's llama-server provably
 * serves exactly the requested model, and the freshly probed endpoint is
 * published through REDTEAM_LOCAL_BASE_URL — the local provider's documented
 * configuration channel, read at call time — before dispatch. A stopped or
 * replaced local server therefore gets a 409 with the reason, never a
 * completion attempt against a dead endpoint. Other providers dispatch
 * through the router as-is; an unknown provider or a missing key surfaces
 * the router's own honest error as a 502.
 */
import type { ServerResponse } from 'node:http';
import { complete } from '@secscan/redteam-llm-router';
import { type LocalModelProbe } from '../local-model.js';
/** Seams for tests: environment, endpoint probe, and the completion call. */
export interface ChatRouteDeps {
    readonly env?: NodeJS.ProcessEnv;
    readonly probe?: LocalModelProbe;
    readonly completeFn?: typeof complete;
}
export declare function handleChat(res: ServerResponse, body: unknown, deps?: ChatRouteDeps): Promise<void>;
