/** Paths, globs, and names the client package verifier reads from the repository. */

/** Gate name that prefixes every diagnostic and console line. */
export const GATE = 'verify-client-packages'
/** Manifests of the packages that must declare exactly one client mode. */
export const CLIENT_MANIFEST_GLOB = 'packages/client/*/package.json'
/** Every workspace manifest that may declare `dsh.client`. */
export const MANIFEST_GLOBS = ['packages/*/*/package.json', 'apps/*/package.json', 'vendor/*/package.json']
/** Build configs whose preset decides whether a package is statically linked. */
export const CONFIG_GLOB = 'packages/*/*/tsdown.config.ts'
/** Shell source that seeds the platform modules and the preloaded externals. */
export const PLATFORM_SOURCE = 'packages/client/web/src/platform.ts'
/** Parser source that must preload every declared external. */
export const PARSER_PRELOAD_SOURCE = 'packages/client/modules/src/index.ts'
/** Shared preset whose predicate names the statically linked packages. */
export const STATIC_PRESET_SOURCE = 'packages/client/tsdown.client.ts'
/** The shell's own plugin package, which seeds modules without the preset. */
export const CORDIS = '@deepseek-ai/cordis'
