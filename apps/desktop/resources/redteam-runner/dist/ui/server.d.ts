/**
 * UI HTTP server (v0.22.0).
 *
 * Security posture (non-negotiable — this console drives live pentest tooling):
 *  - binds 127.0.0.1 by default; any --listen override prints a loud warning
 *  - every /api/* route needs the startup token (Bearer or auth cookie)
 *  - / serves the dashboard only when authed, else a token login page
 */
import { UiStore } from "./store.js";
import type { UiServerOptions } from "./types.js";
export interface UiServerHandle {
    port: number;
    /** The address the socket actually bound to (asserted 127.0.0.1 in tests). */
    address: string;
    token: string;
    close: () => Promise<void>;
}
/** Start the UI server. Resolves when listening; the process stays alive. */
export declare function startUiServer(opts?: UiServerOptions): Promise<UiServerHandle>;
export { UiStore };
export type { UiServerOptions };
