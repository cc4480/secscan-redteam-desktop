/**
 * Deliverable file route (Q-DOC-ACTIONS): stream one file of an
 * engagement's closing deliverable set, byte for byte, as a download.
 *
 * The chat client offers Copy/Download on the documents a finished scan
 * produced; the bytes cross only here, streamed (the package zip can
 * carry every proof bundle). The file name is refused unless it is one
 * of the deliverable set's own names (DELIVERABLE_FILES) — no other
 * engagement-directory file (state, events, proof bundles) is reachable
 * through this route, and the engagement id passes the store's
 * traversal guard like every other route. A missing file is a 404: the
 * client renders that name as a gap with no actions, matching the
 * autofire contract that an incomplete set never reads as complete.
 * HEAD answers the same headers with no body — the client's download
 * action probes with HEAD before handing the route to the browser's
 * download manager (the session-log export pattern).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { UiStore } from "../store.js";
/**
 * GET|HEAD /api/engagements/:id/deliverables/:file — the file's exact
 * bytes with an attachment disposition, or 404 when the engagement or
 * the deliverable does not exist.
 */
export declare function handleDeliverable(store: UiStore, req: IncomingMessage, res: ServerResponse, id: string, file: string): void;
