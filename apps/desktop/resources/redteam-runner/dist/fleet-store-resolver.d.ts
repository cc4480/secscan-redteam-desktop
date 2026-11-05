/**
 * Store-backed fleet configuration resolver for the runner host.
 *
 * The fleet's provider keys and selection live in the app's credentials
 * store — the `.credentials.yaml` document under the harness home that
 * the desktop's credentials service owns and the web Models page writes
 * through (see @deepseek-ai/dsh-credentials-local). The desktop host and
 * this runner are separate processes, so the shared medium is that file:
 * the store's own design reloads it on external change, and this resolver
 * does the same at dispatch time — a key seated or rotated in the app
 * reaches the fleet's next dispatch without a runner restart.
 *
 * The provider selection (`REDTEAM_LLM_PROVIDER`) has one more source,
 * consulted after the store file: the desktop's published fleet provider
 * record (`fleet-provider.json` beside the store document), which the
 * desktop rewrites whenever the app's effective selection changes —
 * including local-server transitions that happen long after this process
 * launched, which no environment the runner inherited can describe. The
 * record serves the selection name only; keys never come from it.
 *
 * Resolution order mirrors the store's own: the launching environment
 * wins (a per-run override stays an override), then the stored file,
 * then — for the selection alone — the desktop's record, and finally
 * the router's own default. Values are never logged and never included
 * in error strings.
 */
import type { FleetConfigResolver } from "@secscan/redteam-llm-router";
/**
 * Create the store-backed fleet resolver over the app credentials store.
 * Both documents are loaded once here: a malformed document fails loud
 * at startup, exactly as the credentials provider itself refuses it.
 * Later edits are picked up per call; a document that turns malformed
 * after startup keeps serving its last good contents (the store's own
 * live reload posture), and a document that disappears stops serving,
 * exactly as an absent store stops serving keys.
 * @param env - environment to resolve against; defaults to `process.env`.
 * @returns the resolver to install via the router's `setFleetConfigResolver`.
 */
export declare function createStoreFleetConfigResolver(env?: NodeJS.ProcessEnv): FleetConfigResolver;
