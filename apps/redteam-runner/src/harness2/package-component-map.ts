/**
 * Harness2 component path map + verbatim reads (H2-P2, spec section 6).
 *
 * COMPONENT_FILE_MAP is the documented, repo-relative map from every EDITABLE
 * Harness2 component to the files that implement it. Section 6 requires the
 * FULL contents of every editable component ("no summaries"), so files are read
 * verbatim; a "dir" source is expanded to every file (small bounded sets) and an
 * "index" source contributes a path list only (broad trees such as src/targets,
 * so the package stays inside its token budget). Every entry carries a sha256 of
 * the bytes shipped, so the editor and the tuner can prove which version of the
 * harness they reasoned about.
 *
 * The guardrail component is PINNED (contract.PINNED_COMPONENT): it is absent
 * from the editable map by construction, its CONTENTS are never read into a
 * package, and every resolved path is additionally checked against the pinned
 * path hints. Section 6 lists guardrails as path + content hash +
 * PINNED_MARKER only, which is exactly what readPinnedGuardrails returns.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HARNESS_COMPONENTS } from "./contract.js";
import type { HarnessComponentId } from "./contract.js";

/** The exact section-6 marker that forbids proposals against a file. */
export const PINNED_MARKER = "PINNED - DO NOT PROPOSE CHANGES" as const;

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

/** One editable file (or directory index) shipped verbatim in section 2. */
export interface ComponentFile {
  readonly component: HarnessComponentId;
  /** Repo-relative path (forward slashes). */
  readonly path: string;
  /** sha256 hex of the bytes shipped. */
  readonly sha256: string;
  /** Full text, never summarised. */
  readonly body: string;
}

/** One pinned guardrail: path + hash + marker. The contents are never shipped. */
export interface GuardrailFile {
  readonly path: string;
  readonly sha256: string;
  readonly marker: typeof PINNED_MARKER;
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

/** Repo-relative pinned guardrail roots; contents are hashed, never shipped. */
export const PINNED_GUARDRAIL_SOURCES: readonly ComponentSource[] = [
  dir(`${R}src/safety`),
  dir(`${R}src/policy`),
  file(`${R}src/gate.ts`),
  dir(`${R}src/accountability`),
  dir("packages/redteam/auth-gate"),
  file("packages/redteam/harness-plugin/src/auth-gate.ts"),
];

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

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
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

/** Read the current editable component files verbatim (with sha256); pins never included. */
export function readComponentFiles(repoRoot: string): ComponentFile[] {
  const out: ComponentFile[] = [];
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
        const body = readFileSync(absolute, "utf8");
        out.push({ component, path: source.path, sha256: sha256(body), body });
      } else if (stat.isDirectory()) {
        const files: string[] = [];
        walkFiles(absolute, files);
        if (source.kind === "index") {
          const body = indexBody(repoRoot, absolute, files);
          out.push({ component, path: source.path, sha256: sha256(body), body });
        } else {
          for (const entry of files) {
            if (isPinnedPath(entry)) continue;
            const body = readFileSync(entry, "utf8");
            out.push({ component, path: repoPath(repoRoot, entry), sha256: sha256(body), body });
          }
        }
      }
    }
  }
  return out;
}

/**
 * Read the pinned guardrails as path + content hash + marker only. This is the
 * one place guardrail files are opened: their bytes are hashed and then
 * dropped, so a package can prove a proposal targets the pinned version without
 * ever shipping an editable copy of it.
 */
export function readPinnedGuardrails(repoRoot: string): GuardrailFile[] {
  const out: GuardrailFile[] = [];
  for (const source of PINNED_GUARDRAIL_SOURCES) {
    const absolute = join(repoRoot, source.path);
    let stat;
    try {
      stat = statSync(absolute);
    } catch {
      continue;
    }
    const files: string[] = [];
    if (stat.isFile()) files.push(absolute);
    else if (stat.isDirectory()) walkFiles(absolute, files);
    for (const entry of files) {
      out.push({ path: repoPath(repoRoot, entry), sha256: sha256(readFileSync(entry, "utf8")), marker: PINNED_MARKER });
    }
  }
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}
