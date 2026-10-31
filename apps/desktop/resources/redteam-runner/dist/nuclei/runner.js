/**
 * Nuclei subprocess runner (v0.21.0).
 *
 * Executes the operator-installed `nuclei` binary as a subprocess with the
 * runner-built argv (never agent-supplied shell text). Output is parsed as
 * JSONL, one finding object per line. The child is killed on abort (the
 * kill switch) and on timeout. Injectable spawn makes the whole thing
 * testable with a fake binary — no real nuclei needed in tests.
 */
import { spawn } from "node:child_process";
import { redactSecrets } from "../host-exec/common.js";
const CVE_RE = /CVE-\d{4}-\d{4,7}/i;
/** Extract a CVE from a template id or name (template ids embed CVEs). */
export function extractCveFromTemplate(templateId, name) {
    const m = `${templateId} ${name}`.match(CVE_RE);
    return m ? m[0].toUpperCase() : undefined;
}
/** Real subprocess spawn — argv array, no shell, ever. */
export function realNucleiSpawn() {
    return (argv, opts) => new Promise((resolve) => {
        const [bin, ...args] = argv;
        let child;
        try {
            child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
        }
        catch (err) {
            resolve({ stdout: "", stderr: String(err), exitCode: null, killed: false, timedOut: false });
            return;
        }
        let stdout = "";
        let stderr = "";
        let done = false;
        const finish = (r) => {
            if (done)
                return;
            done = true;
            resolve(r);
        };
        const timer = setTimeout(() => {
            try {
                child.kill("SIGKILL");
            }
            catch { /* already gone */ }
            finish({ stdout, stderr, exitCode: null, killed: true, timedOut: true });
        }, opts.timeoutMs);
        if (opts.signal) {
            if (opts.signal.aborted) {
                clearTimeout(timer);
                try {
                    child.kill("SIGKILL");
                }
                catch { /* already gone */ }
                finish({ stdout, stderr, exitCode: null, killed: true, timedOut: false });
                return;
            }
            opts.signal.addEventListener("abort", () => {
                clearTimeout(timer);
                try {
                    child.kill("SIGKILL");
                }
                catch { /* already gone */ }
                finish({ stdout, stderr, exitCode: null, killed: true, timedOut: false });
            }, { once: true });
        }
        child.stdout?.on("data", (d) => {
            stdout += d.toString("utf8");
            if (stdout.length > 4_000_000) {
                try {
                    child.kill("SIGKILL");
                }
                catch { /* already gone */ }
            }
        });
        child.stderr?.on("data", (d) => { stderr += d.toString("utf8").slice(0, 8000); });
        child.on("error", (err) => {
            clearTimeout(timer);
            finish({ stdout, stderr: stderr + String(err), exitCode: null, killed: false, timedOut: false });
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            finish({ stdout, stderr, exitCode: code, killed: false, timedOut: false });
        });
    });
}
/** Parse nuclei -jsonl output into findings. Lenient — bad lines are counted, not fatal. */
export function parseNucleiJsonl(stdout, secrets = []) {
    const findings = [];
    let parseErrors = 0;
    let rawLines = 0;
    for (const line of stdout.split("\n")) {
        const t = line.trim();
        if (!t)
            continue;
        rawLines++;
        let obj;
        try {
            obj = JSON.parse(t);
        }
        catch {
            parseErrors++;
            continue;
        }
        const templateId = String(obj["template-id"] ?? obj["templateID"] ?? "unknown");
        const info = (obj["info"] ?? {});
        const name = String(info["name"] ?? templateId);
        const severity = String(info["severity"] ?? obj["severity"] ?? "unknown").toLowerCase();
        const tags = Array.isArray(info["tags"]) ? info["tags"].map(String) : [];
        const matchedAt = String(obj["matched-at"] ?? obj["host"] ?? "");
        const excerpt = redactSecrets(String(obj["extracted-results"] ?? obj["matcher-name"] ?? "").slice(0, 500), secrets);
        findings.push({
            templateId, name, severity,
            host: String(obj["host"] ?? ""),
            matchedAt,
            cve: extractCveFromTemplate(templateId, name),
            tags, excerpt,
        });
    }
    return { findings, parseErrors, rawLines };
}
//# sourceMappingURL=runner.js.map