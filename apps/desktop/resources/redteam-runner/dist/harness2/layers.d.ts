import type { Harness2Paths, PatchLayer } from "./contract.js";
/** Guardrail targets a layer may never touch. */
export declare const PINNED_YAML_TARGETS: readonly ["src/safety", "src/policy", "auth-gate"];
/** Section 11: the hard cap on ACTIVE tuning layers per profile. */
export declare const MAX_ACTIVE_LAYERS = 5;
/** The composition manifest file name inside `paths.layers`. */
export declare const ACTIVE_MANIFEST = "active.json";
/** The layer document file name inside one layer directory. */
export declare const LAYER_FILE = "layer.yml";
export interface LayerGuardrailCheck {
    readonly allowed: boolean;
    /** The pinned targets the YAML touches; empty when allowed. */
    readonly pinned: readonly string[];
}
/** Check a layer YAML against the pinned guardrail targets. Pure. */
export declare function checkLayerGuardrails(yaml: string): LayerGuardrailCheck;
/** Throw when a layer touches a pinned guardrail target. Called before any write. */
export declare function assertLayerGuardrails(layer: PatchLayer): void;
/** Absolute directory of one layer; the id is validated first. */
export declare function layerDir(paths: Harness2Paths, id: string): string;
/** Absolute path of the ordered composition manifest. */
export declare function activeManifestPath(paths: Harness2Paths): string;
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
/**
 * Read one installed layer. Returns null when the layer directory does not
 * exist; throws when it exists but is corrupt (missing/mismatched meta), because
 * a layer that cannot be verified must never be mounted.
 */
export declare function readLayer(paths: Harness2Paths, id: string): PatchLayer | null;
/** Every installed layer, sorted by id (deterministic; composition order comes from active.json). */
export declare function listLayers(paths: Harness2Paths): PatchLayer[];
/**
 * Install one adopted layer: `<id>/layer.yml` + `<id>/meta.json`, atomic. The
 * guardrail check runs first, so a pinned-target layer leaves no directory
 * behind. An existing layer refuses to be replaced unless `force` is set: the
 * install is adoption evidence, not a scratch file.
 */
export declare function installLayer(paths: Harness2Paths, layer: PatchLayer, options?: InstallLayerOptions): InstalledLayer;
/** Read the ordered composition manifest; [] when it does not exist yet. */
export declare function activeLayerIds(paths: Harness2Paths): string[];
/**
 * Replace the ordered composition manifest. Every id must already be installed;
 * mount order is the array order (later layers win). Returns the stored order.
 * Section 11 cap: a 6th active layer is refused (consolidation first).
 */
export declare function setActiveLayers(paths: Harness2Paths, ids: readonly string[]): string[];
/**
 * The ordered layer list a run would mount. Fails closed: a manifest entry with
 * no installed layer refuses the whole composition instead of mounting a
 * partially-applied harness (the rollout must never be silently narrower).
 */
export declare function composeActiveLayers(paths: Harness2Paths): PatchLayer[];
/**
 * Roll a layer back: delete its directory (the rollback) and drop it from the
 * manifest so it can never compose again. Returns true when a layer existed.
 */
export declare function removeLayer(paths: Harness2Paths, layerId: string): boolean;
