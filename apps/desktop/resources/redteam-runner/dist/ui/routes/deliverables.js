import { DELIVERABLE_FILES } from "../../report/deliverables.js";
import { json } from "./http.js";
const CONTENT_TYPES = {
    "report.html": "text/html; charset=utf-8",
    "report.md": "text/markdown; charset=utf-8",
    "report.json": "application/json; charset=utf-8",
    "report.txt": "text/plain; charset=utf-8",
    "findings.csv": "text/csv; charset=utf-8",
    "report.docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "report-package.zip": "application/zip",
};
/**
 * Content-Security-Policy of the display variant: the report renders
 * its inline styles and data: images/fonts, and nothing else — no
 * script, no connections, no forms, no framing by any origin but the
 * console's own. The trailing `sandbox` directive puts the framed
 * document in an opaque origin even if a client drops the frame's
 * sandbox attribute.
 */
const DISPLAY_CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox";
/**
 * GET|HEAD /api/engagements/:id/deliverables/:file — the file's exact
 * bytes with an attachment disposition, or 404 when the engagement or
 * the deliverable does not exist. With the exact query marker
 * `display=inline` on report.html, the same bytes are served inline
 * under DISPLAY_CSP for the thread's preview frame instead.
 */
export function handleDeliverable(store, req, res, id, file, query) {
    if (!DELIVERABLE_FILES.includes(file)) {
        json(res, 404, { error: "not a deliverable file" });
        return;
    }
    const artifact = store.openArtifact(id, file);
    if (artifact === null) {
        json(res, 404, { error: "deliverable not found" });
        return;
    }
    if (file === "report.html" && query.get("display") === "inline") {
        res.writeHead(200, {
            "Content-Type": CONTENT_TYPES[file] ?? "application/octet-stream",
            "Content-Length": artifact.size,
            "Content-Disposition": `inline; filename="${file}"`,
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": DISPLAY_CSP,
        });
    }
    else {
        res.writeHead(200, {
            "Content-Type": CONTENT_TYPES[file] ?? "application/octet-stream",
            "Content-Length": artifact.size,
            "Content-Disposition": `attachment; filename="${file}"`,
            "Cache-Control": "no-store",
        });
    }
    if (req.method === "HEAD") {
        artifact.stream.destroy();
        res.end();
        return;
    }
    artifact.stream.pipe(res);
    // A browser that goes away mid-download ends the file read with it.
    res.on("close", () => { artifact.stream.destroy(); });
}
//# sourceMappingURL=deliverables.js.map