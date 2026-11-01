#!/usr/bin/env node
/**
 * redteam-runner CLI.
 *
 *   redteam-runner start --target secscan.us --mode red \
 *     --objective "assess the external attack surface" \
 *     --scope secscan.us --exclude T1110
 *
 *   redteam-runner watch [--queue <dir>]   # run queued console jobs
 *
 * Credentials via environment only: MODEL_API_KEY (Meta Model API — the
 * fleet's provider key; DEEPSEEK_API_KEY remains supported), QWEN_API_KEY
 * (optional since v0.6), SECSCAN_MCP_TOKEN + SECSCAN_MCP_URL (optional —
 * only the REDTEAM_VERIFY_VIA_SERVICE=1 verification opt-in reads them).
 *
 * Local dev convenience: a .env file is loaded automatically (Node's
 * built-in process.loadEnvFile — no dotenv dependency). Checked in order:
 * cwd's .env first (so a project-local override always wins), then the
 * repo root's .env (so `cd runner && npx redteam-runner ...`, the
 * documented workflow, still finds the root-level .env next to
 * .env.example even though cwd is runner/, not the repo root). Variables
 * already present in the real environment (e.g. from a Secure Vault) take
 * precedence over anything in .env, per Node's documented behavior — this
 * never overrides a production credential source. No .env anywhere is fine.
 */
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
function loadDotEnv() {
    const here = dirname(fileURLToPath(import.meta.url)); // dist/
    const repoRootEnv = join(here, "..", "..", ".env"); // dist/ -> runner/ -> repo root
    const candidates = [".env", repoRootEnv];
    for (const path of candidates) {
        if (!existsSync(path))
            continue;
        try {
            process.loadEnvFile(path);
        }
        catch (err) {
            console.error(`[runner] warning: failed to load ${path}: ${err.message}`);
        }
        return; // first match wins — cwd's .env, if present, is the full override.
    }
}
loadDotEnv();
import { main } from "./cli/commands.js";
main().catch((err) => {
    console.error(`[runner] fatal: ${err.message}`);
    process.exit(1);
});
//# sourceMappingURL=cli.js.map