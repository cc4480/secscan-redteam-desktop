/**
 * GET /api/models — which model providers the fleet can use right now and
 * which provider/model each role is seated on. Backs the chat view's engine
 * banner so the operator can SEE the active models (e.g. Meta Muse Spark)
 * instead of trusting an env var.
 *
 * `localModel` is the desktop's bundled local model while its llama-server
 * provably serves the operator's active pick (see ../local-model.ts): the
 * one entry the chat picker can route to outside the fleet seats. It is
 * null whenever no local server is serving — the picker then simply has no
 * local option. Fleet seats are reported exactly as the policy resolves
 * them; the local entry never changes a seat.
 */
import type { ServerResponse } from 'node:http';
import { type LocalModelProbe } from '../local-model.js';
/** Seams for tests: the environment to read and the endpoint probe. */
export interface ModelsRouteDeps {
    readonly env?: NodeJS.ProcessEnv;
    readonly probe?: LocalModelProbe;
}
export declare function handleModels(res: ServerResponse, deps?: ModelsRouteDeps): Promise<void>;
