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
import { DELIVERABLE_FILES } from "../../report/deliverables.js";
import type { UiStore } from "../store.js";
import { json } from "./http.js";

const CONTENT_TYPES: Record<string, string> = {
  "report.html": "text/html; charset=utf-8",
  "report.md": "text/markdown; charset=utf-8",
  "report.json": "application/json; charset=utf-8",
  "report.txt": "text/plain; charset=utf-8",
  "findings.csv": "text/csv; charset=utf-8",
  "report.docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "report-package.zip": "application/zip",
};

/**
 * GET|HEAD /api/engagements/:id/deliverables/:file — the file's exact
 * bytes with an attachment disposition, or 404 when the engagement or
 * the deliverable does not exist.
 */
export function handleDeliverable(store: UiStore, req: IncomingMessage, res: ServerResponse, id: string, file: string): void {
  if (!(DELIVERABLE_FILES as readonly string[]).includes(file)) {
    json(res, 404, { error: "not a deliverable file" });
    return;
  }
  const artifact = store.openArtifact(id, file);
  if (artifact === null) {
    json(res, 404, { error: "deliverable not found" });
    return;
  }
  res.writeHead(200, {
    "Content-Type": CONTENT_TYPES[file] ?? "application/octet-stream",
    "Content-Length": artifact.size,
    "Content-Disposition": `attachment; filename="${file}"`,
    "Cache-Control": "no-store",
  });
  if (req.method === "HEAD") {
    artifact.stream.destroy();
    res.end();
    return;
  }
  artifact.stream.pipe(res);
  // A browser that goes away mid-download ends the file read with it.
  res.on("close", () => { artifact.stream.destroy(); });
}
