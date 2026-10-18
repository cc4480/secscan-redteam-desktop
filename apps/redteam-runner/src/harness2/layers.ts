/**
 * Harness2 patch-layer store (H2-P2b).
 *
 * Adopted patch layers live under `paths.layers`, one directory per layer:
 *
 *   <paths.layers>/<layer-id>/layer.yml   the cordis patch document (verbatim)
 *   <paths.layers>/<layer-id>/meta.json   id, targetClass, adoptedAt, evidenceRunId,
 *                                         installedAt, sha256(layer.yml)
 *   <paths.layers>/active.json            the ORDERED composition manifest
 *                                         { layerIds: string[], updatedAt }
 *
 * Mount order is the manifest order (later layers win), so the manifest is the
 * composition: `composeActiveLayers()` returns exactly what a run would mount.
 * Writes are atomic (tmp + rename, unlink first because Windows rename cannot
 * replace) so a crash never leaves a half-read layer.
 *
 * Guardrail guard (safety-critical): a layer that touches a pinned guardrail
 * target is refused BEFORE anything is written. Pinned targets are
 * `src/safety`, `src/policy` and `auth-gate` (the contract's PINNED_COMPONENT
 * file set), plus a YAML row whose target/component is `guardrails`. This is
 * defense in depth: the P2a response parser rejects such proposals too, but the
 * layer store must not install one even if it arrives through another path.
 *
 * rollback = `removeLayer`: deleting the directory is the rollback, and the id
 * is dropped from the manifest so a removed layer can never be composed.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Harness2Paths, PatchLayer } from "./contract.js";

/** Guardrail targets a layer may never touch. */
export const PINNED_YAML_TARGETS = ["src/safety", "src/policy", "auth-gate"] as const;

/** A YAML row that targets the pinned guardrails component, e.g. `component: guardrails`. */
const PINNED_COMPONENT_KEY = /^[ \t-]*(?:component|target|targets)[ \t]*:[ \t]*["']?guardrails\b/im;

/** Layer ids become directory names: same conservative charset the runner uses for engagement ids. */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** The composition manifest file name inside `paths.layers`. */
export const ACTIVE_MANIFEST = "active.json";
/** The layer document file name inside one layer directory. */
export const LAYER_FILE = "layer.yml";
const META_FILE = "meta.json";

export interface LayerGuardrailCheck {
  readonly allowed: boolean;
  /** The pinned targets the YAML touches; empty when allowed. */
  readonly pinned: readonly string[];
}

/** Check a layer YAML against the pinned guardrail targets. Pure. */
export function checkLayerGuardrails(yaml: string): LayerGuardrailCheck {
  const normalized = yaml.toLowerCase().replaceAll("\\", "/");
  const pinned: string[] = PINNED_YAML_TARGETS.filter((target) => normalized.includes(target));
  if (PINNED_COMPONENT_KEY.test(yaml)) pinned.push("guardrails");
  return { allowed: pinned.length === 0, pinned };
}

/** Throw when a layer touches a pinned guardrail target. Called before any write. */
export function assertLayerGuardrails(layer: PatchLayer): void {
  const check = checkLayerGuardrails(layer.yaml);
  if (!check.allowed) {
    throw new Error(
      `[harness2] refused layer "${layer.id}": it targets pinned guardrails (${check.pinned.join(", ")}). ` +
        "Guardrails are not editable; a layer touching them is never installed.",
    );
  }
}

/** sha256 hex of the layer document, recorded in meta.json so tampering is detectable. */
function sha256(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

/** Write via a temporary file then rename; no partial file is ever visible. */
function atomicWrite(path: string, body: string): void {
  const tmp = `${path}.tmp-${process.pid}-${Date.now().toString(36)}`;
  try {
    writeFileSync(tmp, body);
    try {
      renameSync(tmp, path);
    } catch {
      rmSync(path, { force: true });
      renameSync(tmp, path);
    }
  } finally {
    if (existsSync(tmp)) rmSync(tmp, { force: true });
  }
}

function assertSafeId(id: string): void {
  if (!SAFE_ID.test(id)) {
    throw new Error(`[harness2] unsafe layer id ${JSON.stringify(id)}: want ${SAFE_ID.source}`);
  }
}

/** Absolute directory of one layer; the id is validated first. */
export function layerDir(paths: Harness2Paths, id: string): string {
  assertSafeId(id);
  return join(paths.layers, id);
}

/** Absolute path of the ordered composition manifest. */
export function activeManifestPath(paths: Harness2Paths): string {
  return join(paths.layers, ACTIVE_MANIFEST);
}

export interface LayerMeta {
  readonly id: string;
  readonly targetClass: string | null;
  readonly adoptedAt: string;
  readonly evidenceRunId: string;
  readonly installedAt: string;
  readonly sha256: string;
}

/** What installLayer wrote: the parsed layer plus the on-disk paths. */
export interface InstalledLayer {
  readonly layer: PatchLayer;
  readonly dir: string;
  readonly layerPath: string;
  readonly metaPath: string;
}

export interface InstallLayerOptions {
  /** Replace an already-installed layer. Absent/false = refuse (never silently overwrite adoption evidence). */
  readonly force?: boolean;
  /** ISO timestamp recorded as installedAt; defaults to now (tests pin it). */
  readonly installedAt?: string;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function stringField(raw: Record<string, unknown>, name: string): string {
  const value = raw[name];
  if (typeof value !== "string") throw new Error(`[harness2] layer meta.json field "${name}" is not a string`);
  return value;
}

/**
 * Read one installed layer. Returns null when the layer directory does not
 * exist; throws when it exists but is corrupt (missing/mismatched meta), because
 * a layer that cannot be verified must never be mounted.
 */
export function readLayer(paths: Harness2Paths, id: string): PatchLayer | null {
  const dir = layerDir(paths, id);
  const layerPath = join(dir, LAYER_FILE);
  const metaPath = join(dir, META_FILE);
  if (!existsSync(layerPath)) {
    if (existsSync(dir)) throw new Error(`[harness2] layer "${id}" exists without ${LAYER_FILE}; refusing to use it`);
    return null;
  }
  if (!existsSync(metaPath)) throw new Error(`[harness2] layer "${id}" is missing ${META_FILE}; refusing to use it`);
  const yaml = readFileSync(layerPath, "utf8");
  const raw = readJson(metaPath) as Record<string, unknown>;
  const recorded = stringField(raw, "sha256");
  if (recorded !== sha256(yaml)) {
    throw new Error(`[harness2] layer "${id}" failed its integrity check: ${LAYER_FILE} does not match meta.json sha256`);
  }
  const targetClass = raw["targetClass"];
  return {
    id: stringField(raw, "id"),
    ...(typeof targetClass === "string" && targetClass !== "" ? { targetClass } : {}),
    yaml,
    adoptedAt: stringField(raw, "adoptedAt"),
    evidenceRunId: stringField(raw, "evidenceRunId"),
  };
}

/** Every installed layer, sorted by id (deterministic; composition order comes from active.json). */
export function listLayers(paths: Harness2Paths): PatchLayer[] {
  if (!existsSync(paths.layers)) return [];
  const layers: PatchLayer[] = [];
  for (const entry of readdirSync(paths.layers, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const layer = readLayer(paths, entry.name);
    if (layer !== null) layers.push(layer);
  }
  return layers;
}

/**
 * Install one adopted layer: `<id>/layer.yml` + `<id>/meta.json`, atomic. The
 * guardrail check runs first, so a pinned-target layer leaves no directory
 * behind. An existing layer refuses to be replaced unless `force` is set: the
 * install is adoption evidence, not a scratch file.
 */
export function installLayer(paths: Harness2Paths, layer: PatchLayer, options: InstallLayerOptions = {}): InstalledLayer {
  const dir = layerDir(paths, layer.id);
  assertLayerGuardrails(layer);
  if (layer.adoptedAt.trim() === "") {
    throw new Error(`[harness2] layer "${layer.id}" has no adoptedAt timestamp`);
  }
  if (layer.yaml.trim() === "") throw new Error(`[harness2] layer "${layer.id}" has an empty YAML body`);
  if (existsSync(dir) && options.force !== true) {
    throw new Error(
      `[harness2] layer "${layer.id}" is already installed; refusing to overwrite adopted evidence without force`,
    );
  }
  const layerPath = join(dir, LAYER_FILE);
  const metaPath = join(dir, META_FILE);
  const yaml = layer.yaml.endsWith("\n") ? layer.yaml : `${layer.yaml}\n`;
  const meta: LayerMeta = {
    id: layer.id,
    targetClass: layer.targetClass ?? null,
    adoptedAt: layer.adoptedAt,
    evidenceRunId: layer.evidenceRunId,
    installedAt: options.installedAt ?? new Date().toISOString(),
    sha256: sha256(yaml),
  };
  mkdirSync(dir, { recursive: true });
  atomicWrite(layerPath, yaml);
  atomicWrite(metaPath, JSON.stringify(meta, null, 2));
  return { layer, dir, layerPath, metaPath };
}

/** Read the ordered composition manifest; [] when it does not exist yet. */
export function activeLayerIds(paths: Harness2Paths): string[] {
  const path = activeManifestPath(paths);
  if (!existsSync(path)) return [];
  let raw: unknown;
  try {
    raw = readJson(path);
  } catch (err) {
    throw new Error(`[harness2] cannot read the active layer manifest ${path}: ${(err as Error).message}`);
  }
  const ids = Array.isArray(raw) ? raw : (raw as Record<string, unknown> | null)?.["layerIds"];
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) {
    throw new Error(`[harness2] active layer manifest ${path} has no string[] layerIds`);
  }
  return [...new Set(ids)];
}

function writeActiveManifest(paths: Harness2Paths, ids: readonly string[]): void {
  mkdirSync(paths.layers, { recursive: true });
  atomicWrite(
    activeManifestPath(paths),
    JSON.stringify({ layerIds: [...ids], updatedAt: new Date().toISOString() }, null, 2),
  );
}

/**
 * Replace the ordered composition manifest. Every id must already be installed;
 * mount order is the array order (later layers win). Returns the stored order.
 */
export function setActiveLayers(paths: Harness2Paths, ids: readonly string[]): string[] {
  const ordered = [...new Set(ids)];
  for (const id of ordered) {
    if (readLayer(paths, id) === null) {
      throw new Error(`[harness2] cannot activate "${id}": it is not installed under ${paths.layers}`);
    }
  }
  writeActiveManifest(paths, ordered);
  return ordered;
}

/**
 * The ordered layer list a run would mount. Fails closed: a manifest entry with
 * no installed layer refuses the whole composition instead of mounting a
 * partially-applied harness (the rollout must never be silently narrower).
 */
export function composeActiveLayers(paths: Harness2Paths): PatchLayer[] {
  const ids = activeLayerIds(paths);
  return ids.map((id) => {
    const layer = readLayer(paths, id);
    if (layer === null) {
      throw new Error(
        `[harness2] active manifest references missing layer "${id}"; refusing to compose a partial harness ` +
          "(roll back the layer or re-install it, then run setActiveLayers)",
      );
    }
    return layer;
  });
}

/**
 * Roll a layer back: delete its directory (the rollback) and drop it from the
 * manifest so it can never compose again. Returns true when a layer existed.
 */
export function removeLayer(paths: Harness2Paths, layerId: string): boolean {
  const dir = layerDir(paths, layerId);
  const existed = existsSync(dir);
  if (existed) rmSync(dir, { recursive: true, force: true });
  const ids = activeLayerIds(paths);
  if (ids.includes(layerId)) writeActiveManifest(paths, ids.filter((id) => id !== layerId));
  return existed;
}
