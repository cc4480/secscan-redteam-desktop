/**
 * Harness2 component path map + verbatim reads (H2-P2a).
 *
 * COMPONENT_FILE_MAP is the documented, repo-relative map from every EDITABLE
 * Harness2 component to the files that implement it. Files are read verbatim;
 * a "dir" source is expanded to every file (small bounded sets) and an "index"
 * source contributes only a path list (broad dirs such as src/targets and the
 * integration trees, so the package stays inside its token budget). A dist-only
 * payload has no sources, so componentFiles is simply empty.
 *
 * The guardrail component is PINNED (contract.PINNED_COMPONENT): it is absent
 * from the map by construction, and every resolved path is additionally checked
 * against the pinned path hints, so src/safety, src/policy, src/gate.ts,
 * src/accountability and auth-gate can never enter a package.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HARNESS_COMPONENTS } from "./contract.js";
import type { HarnessComponentId, ProposalPackage } from "./contract.js";

/** Labels of the pinned guardrail paths; any touch of these is a security event. */
export const PINNED_PATH_LABELS = ["src/safety", "src/policy", "src/gate.ts", "src/accountability", "auth-gate"] as const;

const PINNED_PATTERNS: readonly (readonly [string, RegExp])[] = [
  ["src/safety", /(^|[^a-z0-9_-])src\/safety([^a-z0-9_-]|$)/],
  ["src/policy", /(^|[^a-z0-9_-])src\/policy([^a-z0-9_-]|$)/],
  ["src/gate.ts", /(^|[^a-z0-9_-])src\/gate\.ts([^a-z0-9_-]|$)/],
  ["src/accountability", /(^|[^a-z0-9_-])src\/accountability([^a-z0-9_-]|$)/],
  ["auth-gate", /auth[-_ ]?gate/],
];

/** Lowercase and normalize separators so `SRC\SAFETY` cannot slip past the pin. */
export function normalizeForPin(text: string): string {
  return text.toLowerCase().replace(/\\/g, "/");
}

/** Pinned guardrail path labels the text touches; empty means clean. */
export function findPinnedTouch(text: string): readonly string[] {
  const normalized = normalizeForPin(text);
  return PINNED_PATTERNS.filter(([, pattern]) => pattern.test(normalized)).map(([label]) => label);
}

/** True when a repo-relative path belongs to the pinned guardrail component. */
export function isPinnedPath(path: string): boolean {
  return findPinnedTouch(path).length > 0;
}

export interface ComponentSource {
  /** Repo-relative path (forward slashes). */
  readonly path: string;
  /** file = verbatim source; dir = verbatim file set; index = path list only. */
  readonly kind: "file" | "dir" | "index";
}

const R = "apps/redteam-runner/";
const file = (path: string): ComponentSource => ({ path, kind: "file" });
const dir = (path: string): ComponentSource => ({ path, kind: "dir" });
const index = (path: string): ComponentSource => ({ path, kind: "index" });

/** Documented component-path map (repo-relative). Guardrails are excluded. */
export const COMPONENT_FILE_MAP: Readonly<Partial<Record<HarnessComponentId, readonly ComponentSource[]>>> = {
  [HARNESS_COMPONENTS.systemPrompt]: [file(`${R}src/prompts.ts`), dir(`${R}src/prompts`)],
  [HARNESS_COMPONENTS.toolGuidance]: [file(`${R}src/tools.ts`), dir(`${R}src/tools`)],
  [HARNESS_COMPONENTS.subagents]: [file(`${R}src/agents.ts`), file("packages/redteam/harness-plugin/src/redteam-profile.ts")],
  [HARNESS_COMPONENTS.memory]: [file(`${R}src/registry.ts`), dir(`${R}src/registry`)],
  [HARNESS_COMPONENTS.skills]: [file(`${R}src/targets.ts`), file(`${R}src/battery.ts`), file(`${R}src/attack.ts`), index(`${R}src/targets`)],
  [HARNESS_COMPONENTS.scripts]: [dir(`${R}scripts`)],
  [HARNESS_COMPONENTS.plugins]: [
    file(`${R}src/mcp.ts`),
    dir(`${R}src/integrations`),
    index(`${R}src/xtool`),
    index(`${R}src/host-exec`),
    index(`${R}src/msf`),
    index(`${R}src/nuclei`),
    index(`${R}src/nmap`),
    index(`${R}src/browser`),
  ],
};

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/** Repo root (holds apps/redteam-runner + packages/redteam); dist-only payloads fall back. */
export function findRepoRoot(startDir: string = MODULE_DIR): string {
  let current = resolve(startDir);
  for (let depth = 0; depth < 8; depth++) {
    if (existsSync(join(current, "apps", "redteam-runner", "src")) && existsSync(join(current, "packages", "redteam"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return resolve(startDir, "..", "..");
}

function walkFiles(absolute: string, out: string[]): void {
  for (const name of readdirSync(absolute).sort()) {
    const child = join(absolute, name);
    const stat = statSync(child);
    if (stat.isDirectory()) walkFiles(child, out);
    else if (stat.isFile()) out.push(child);
  }
}

function repoPath(repoRoot: string, absolute: string): string {
  return relative(repoRoot, absolute).split("\\").join("/");
}

function indexBody(repoRoot: string, absolute: string, files: readonly string[]): string {
  const rel = files.map((entry) => repoPath(repoRoot, entry)).sort();
  return [`# Directory index: ${repoPath(repoRoot, absolute)}`, `# ${rel.length} file(s); bodies are not included in this package.`, ...rel].join("\n");
}

/** Read the current editable component files verbatim; pinned guardrails never included. */
export function readComponentFiles(repoRoot: string): ProposalPackage["componentFiles"] {
  const out: { component: HarnessComponentId; path: string; body: string }[] = [];
  for (const component of Object.values(HARNESS_COMPONENTS)) {
    if (component === HARNESS_COMPONENTS.guardrails) continue;
    for (const source of COMPONENT_FILE_MAP[component] ?? []) {
      if (isPinnedPath(source.path)) continue;
      const absolute = join(repoRoot, source.path);
      let stat;
      try {
        stat = statSync(absolute);
      } catch {
        continue;
      }
      if (stat.isFile()) {
        out.push({ component, path: source.path, body: readFileSync(absolute, "utf8") });
      } else if (stat.isDirectory()) {
        const files: string[] = [];
        walkFiles(absolute, files);
        if (source.kind === "index") {
          out.push({ component, path: source.path, body: indexBody(repoRoot, absolute, files) });
        } else {
          for (const entry of files) {
            if (isPinnedPath(entry)) continue;
            out.push({ component, path: repoPath(repoRoot, entry), body: readFileSync(entry, "utf8") });
          }
        }
      }
    }
  }
  return out;
}
