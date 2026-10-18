/**
 * Harness2 harness stamp (H2-P1a).
 *
 * Two runs are only comparable when the composed harness that produced them is
 * identifiable, so every trajectory records a HarnessStamp:
 *
 *  - runnerVersion: the @secscan/redteam-runner package.json version.
 *  - commit: the git revision when cheaply available (env override, else the
 *    checkout's .git/HEAD). A shipped dist-only payload has no .git, so the
 *    field is simply absent there - never invented.
 *  - layerIds: the active dsh patch layers. Runner 0.37.1 has no profile or
 *    composition manifest yet (patch layers arrive with the later H2 phases),
 *    so this is the comma-separated DSH_HARNESS2_LAYERS override, or [].
 *  - componentHashes: sha256 per Harness2 component over its file set. Each
 *    set is hashed as sorted path, NUL, bytes, NUL so a rename changes the
 *    hash too. Source (src/) is preferred; a dist-only deployment falls back
 *    to the compiled dist/ twin (.ts -> .js). A component with no discoverable
 *    files is omitted rather than hashed as empty.
 *  - pinnedComponents: the guardrails component is hashed like any other (so a
 *    stamp PROVES guardrail drift), but it is marked pinned here and can never
 *    appear in a proposal (see contract.PINNED_COMPONENT).
 *
 * Everything is read-only: this module never writes to the runner tree.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HARNESS_COMPONENTS, PINNED_COMPONENT, } from "./contract.js";
const RUNNER_PACKAGE = "@secscan/redteam-runner";
const MAX_ROOT_WALK = 6;
const COMMIT_ENV = ["DSH_HARNESS2_COMMIT", "REDTEAM_GIT_COMMIT", "GIT_COMMIT"];
const HEX_COMMIT = /^[0-9a-f]{7,64}$/i;
const SOURCE_FILE = /\.(ts|js)$/;
const moduleDir = dirname(fileURLToPath(import.meta.url));
/** Env override for the active layer ids (comma separated). */
export const LAYERS_ENV = "DSH_HARNESS2_LAYERS";
/**
 * Component -> file sets, relative to the runner package root. This is the
 * documented mapping for the red-team runner's implementation of the eight
 * Harness2 components; tuning a component changes exactly these files.
 */
export const COMPONENT_PATHS = {
    [HARNESS_COMPONENTS.systemPrompt]: ["src/prompts.ts", "src/prompts"],
    [HARNESS_COMPONENTS.guardrails]: ["src/safety", "src/policy", "src/gate.ts", "src/accountability"],
    [HARNESS_COMPONENTS.memory]: ["src/registry.ts", "src/registry"],
    [HARNESS_COMPONENTS.toolGuidance]: ["src/tools.ts", "src/tools", "src/toolchain.ts", "src/dispatch"],
    [HARNESS_COMPONENTS.subagents]: ["src/agents.ts", "src/phases", "src/context.ts"],
    [HARNESS_COMPONENTS.skills]: ["src/targets.ts", "src/targets", "src/battery.ts", "src/attack.ts"],
    [HARNESS_COMPONENTS.scripts]: ["scripts"],
    [HARNESS_COMPONENTS.plugins]: [
        "src/integrations",
        "src/mcp.ts",
        "src/xtool",
        "src/host-exec",
        "src/msf",
        "src/nuclei",
        "src/nmap",
        "src/browser",
    ],
};
/** Locate the runner package root by walking up to its package.json. */
export function findAppRoot(startDir = moduleDir) {
    let dir = resolve(startDir);
    for (let depth = 0; depth < MAX_ROOT_WALK; depth++) {
        const pkgPath = join(dir, "package.json");
        if (existsSync(pkgPath)) {
            try {
                const raw = JSON.parse(readFileSync(pkgPath, "utf8"));
                if (raw.name === RUNNER_PACKAGE)
                    return dir;
            }
            catch {
                // unreadable package.json: keep walking
            }
        }
        const parent = dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    return resolve(startDir, "..", "..");
}
/** Runner version from package.json; "unknown" when the file is unavailable. */
export function readRunnerVersion(appRoot) {
    try {
        const raw = JSON.parse(readFileSync(join(appRoot, "package.json"), "utf8"));
        return typeof raw.version === "string" && raw.version !== "" ? raw.version : "unknown";
    }
    catch {
        return "unknown";
    }
}
function commitFromGitDir(gitDir) {
    try {
        const head = readFileSync(join(gitDir, "HEAD"), "utf8").trim();
        const ref = /^ref:\s*(\S+)$/.exec(head);
        const value = ref ? readFileSync(join(gitDir, ref[1]), "utf8").trim() : head;
        return HEX_COMMIT.test(value) ? value : undefined;
    }
    catch {
        // worktree file, missing ref or unreadable: no cheap commit
        return undefined;
    }
}
/** Git commit when cheaply available: env override first, then .git/HEAD. */
export function readGitCommit(appRoot, environment = process.env) {
    for (const name of COMMIT_ENV) {
        const value = environment[name]?.trim();
        if (value !== undefined && value !== "" && HEX_COMMIT.test(value))
            return value;
    }
    let dir = appRoot;
    for (let depth = 0; depth < MAX_ROOT_WALK; depth++) {
        const gitDir = join(dir, ".git");
        if (existsSync(gitDir))
            return commitFromGitDir(gitDir);
        const parent = dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    return undefined;
}
/** Active layer ids: explicit override, else DSH_HARNESS2_LAYERS, else none. */
export function resolveLayerIds(environment = process.env, override) {
    if (override !== undefined)
        return override.map((id) => id.trim()).filter((id) => id !== "");
    const raw = environment[LAYERS_ENV] ?? "";
    return raw.split(",").map((id) => id.trim()).filter((id) => id !== "");
}
function collectFiles(path, out) {
    const stat = statSync(path);
    if (stat.isFile()) {
        if (SOURCE_FILE.test(path))
            out.push(path);
        return;
    }
    for (const name of readdirSync(path).sort())
        collectFiles(join(path, name), out);
}
/** src/ preferred, compiled dist/ twin as the dist-only-payload fallback. */
function resolveEntry(appRoot, entry) {
    const candidates = [join(appRoot, entry)];
    if (entry.startsWith("src/")) {
        candidates.push(join(appRoot, entry.replace(/^src\//, "dist/").replace(/\.ts$/, ".js")));
    }
    for (const candidate of candidates) {
        try {
            if (existsSync(candidate))
                return candidate;
        }
        catch {
            // unreadable path: try the next candidate
        }
    }
    return undefined;
}
/** sha256 over the sorted component file set; undefined when nothing was found. */
export function hashComponentFiles(appRoot, paths) {
    const files = [];
    for (const entry of paths) {
        const resolved = resolveEntry(appRoot, entry);
        if (resolved !== undefined)
            collectFiles(resolved, files);
    }
    if (files.length === 0)
        return undefined;
    const hash = createHash("sha256");
    for (const file of files.sort()) {
        hash.update(relative(appRoot, file).split("\\").join("/"));
        hash.update("\0");
        hash.update(readFileSync(file));
        hash.update("\0");
    }
    return hash.digest("hex");
}
/** sha256 per component; a component with no discoverable files is omitted. */
export function componentHashes(appRoot) {
    const hashes = {};
    for (const component of Object.values(HARNESS_COMPONENTS)) {
        const hash = hashComponentFiles(appRoot, COMPONENT_PATHS[component]);
        if (hash !== undefined)
            hashes[component] = hash;
    }
    return hashes;
}
/** Build the harness stamp recorded with every trajectory. */
export function buildHarnessStamp(options = {}) {
    const environment = options.environment ?? process.env;
    const appRoot = options.appRoot ?? findAppRoot();
    const commit = readGitCommit(appRoot, environment);
    return {
        runnerVersion: readRunnerVersion(appRoot),
        ...(commit !== undefined ? { commit } : {}),
        layerIds: resolveLayerIds(environment, options.layerIds),
        componentHashes: componentHashes(appRoot),
        pinnedComponents: [PINNED_COMPONENT],
    };
}
//# sourceMappingURL=harness-stamp.js.map