import { type HarnessComponentId, type HarnessStamp } from "./contract.js";
/** Env override for the active layer ids (comma separated). */
export declare const LAYERS_ENV = "DSH_HARNESS2_LAYERS";
/** A stamp plus the pinned-component marker. Assignable to HarnessStamp. */
export interface HarnessStampWithPins extends HarnessStamp {
    readonly pinnedComponents: readonly HarnessComponentId[];
}
export interface HarnessStampOptions {
    /** Runner package root; discovered from this module when omitted. */
    readonly appRoot?: string;
    /** Environment seam for tests. */
    readonly environment?: NodeJS.ProcessEnv;
    /** Explicit layer ids; wins over the env override. */
    readonly layerIds?: readonly string[];
}
/**
 * Component -> file sets, relative to the runner package root. This is the
 * documented mapping for the red-team runner's implementation of the eight
 * Harness2 components; tuning a component changes exactly these files.
 */
export declare const COMPONENT_PATHS: Readonly<Record<HarnessComponentId, readonly string[]>>;
/** Locate the runner package root by walking up to its package.json. */
export declare function findAppRoot(startDir?: string): string;
/** Runner version from package.json; "unknown" when the file is unavailable. */
export declare function readRunnerVersion(appRoot: string): string;
/** Git commit when cheaply available: env override first, then .git/HEAD. */
export declare function readGitCommit(appRoot: string, environment?: NodeJS.ProcessEnv): string | undefined;
/** Active layer ids: explicit override, else DSH_HARNESS2_LAYERS, else none. */
export declare function resolveLayerIds(environment?: NodeJS.ProcessEnv, override?: readonly string[]): readonly string[];
/** sha256 over the sorted component file set; undefined when nothing was found. */
export declare function hashComponentFiles(appRoot: string, paths: readonly string[]): string | undefined;
/** sha256 per component; a component with no discoverable files is omitted. */
export declare function componentHashes(appRoot: string): Readonly<Partial<Record<HarnessComponentId, string>>>;
/** Build the harness stamp recorded with every trajectory. */
export declare function buildHarnessStamp(options?: HarnessStampOptions): HarnessStampWithPins;
