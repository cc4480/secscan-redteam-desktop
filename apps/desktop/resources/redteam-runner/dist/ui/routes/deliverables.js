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
 * GET|HEAD /api/engagements/:id/deliverables/:file — the file's exact
 * bytes with an attachment disposition, or 404 when the engagement or
 * the deliverable does not exist.
 */
export function handleDeliverable(store, req, res, id, file) {
    if (!DELIVERABLE_FILES.includes(file)) {
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
//# sourceMappingURL=deliverables.js.map