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
 * Resolution order mirrors the store's own: the launching environment
 * wins (a per-run override stays an override), then the stored file.
 * Values are never logged and never included in error strings.
 */

import { readFileSync, statSync } from "node:fs";
import {
  parseCredentialsDocument,
  resolveSpec,
} from "@deepseek-ai/dsh-credentials-local";
import type { FleetConfigResolver } from "@secscan/redteam-llm-router";

/**
 * Create the store-backed fleet resolver over the app credentials store.
 * The document is loaded once here: a malformed document fails loud at
 * startup, exactly as the credentials provider itself refuses it. Later
 * edits are picked up per call; a document that turns malformed after
 * startup keeps serving its last good contents (the store's own live
 * reload posture).
 * @param env - environment to resolve against; defaults to `process.env`.
 * @returns the resolver to install via the router's `setFleetConfigResolver`.
 */
export function createStoreFleetConfigResolver(
  env: NodeJS.ProcessEnv = process.env,
): FleetConfigResolver {
  const dshHome = env["DSH_HOME"]?.trim();
  const filename = resolveSpec(dshHome ? { dshHome } : {}).filename;
  let cache: { mtimeMs: number; size: number; refs: Map<string, string> } | undefined;
  let lastGood: Map<string, string> = new Map();
  let startup = true;

  function load(): Map<string, string> {
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(filename);
    } catch {
      cache = undefined;
      lastGood = new Map();
      startup = false;
      return lastGood;
    }
    if (cache !== undefined && cache.mtimeMs === st.mtimeMs && cache.size === st.size) {
      return cache.refs;
    }
    try {
      const doc = parseCredentialsDocument(readFileSync(filename, "utf8"), filename);
      cache = { mtimeMs: st.mtimeMs, size: st.size, refs: doc.refs };
      lastGood = doc.refs;
    } catch (err) {
      if (startup) throw err;
      // Live reload of a malformed edit: keep serving the last good
      // contents, as the credentials provider does.
    }
    startup = false;
    return lastGood;
  }

  load();

  return {
    valueFor(name: string): string | undefined {
      const fromEnv = env[name];
      if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
      return load().get(name);
    },
  };
}
