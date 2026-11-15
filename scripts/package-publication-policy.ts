/** Package name sets, directory patterns, and publication payload policy. */

/** Vendored packages published under the workspace version and never fetched from a registry. */
export const vendoredPackages = new Set([
  '@deepseek-ai/cordis',
  '@deepseek-ai/cosmokit',
  '@deepseek-ai/schemastery',
  '@deepseek-ai/cordis-plugin-loader',
  '@deepseek-ai/cordis-plugin-include',
  '@deepseek-ai/cordis-plugin-group',
  '@deepseek-ai/cordis-plugin-timer',
  '@deepseek-ai/cordis-plugin-hmr',
  '@deepseek-ai/cordis-plugin-logger-console',
])
/** Landlock packages published on the shared native workspace version. */
export const publicNativePackages = new Set([
  '@deepseek-ai/node-addon-system',
  '@deepseek-ai/node-addon-system-darwin-arm64',
  '@deepseek-ai/node-addon-system-darwin-x64',
  '@deepseek-ai/node-addon-system-linux-arm64',
  '@deepseek-ai/node-addon-system-linux-x64',
])
/** Deliberate source payloads whose exact bytes are part of the package's audit surface. */
export const publicationSourceAllowlist: Readonly<Record<string, readonly string[]>> = {
  '@deepseek-ai/node-addon-system': ['src/main.c', 'src/flock.c'],
}
/** Public source home recorded in maintained package manifests. */
export const publishedRepositoryUrl = 'git+https://github.com/deepseek-ai/deepseek-harness.git'
/** Packages that participate in the experimental policy. */
export const experimentalPackageDirectory = /^packages\/experimental\/[^/]+$/
/** npm namespace reserved for experimental packages. */
export const experimentalPackageNamePrefix = '@deepseek-ai/dsh-experimental-'
/** Ordinary directories whose packages this repository publishes: one release member each. */
export const standardReleaseMemberDirectory =
  /^(?:packages\/(?!experimental\/)[^/]+\/[^/]+|apps\/(?!desktop(?:-host)?$)[^/]+|vendor\/[^/]+)$/
/** Installable application assembled by electron-builder rather than published to npm. */
export const desktopApplicationDirectory = 'apps/desktop'
/** Publication payloads of the app packages that are not dsh-family members. */
export const appPackageFiles: Readonly<Record<string, readonly string[]>> = {
  '@deepseek-ai/dsh': ['lib/*.js', 'lib/types/*.d.ts'],
  '@deepseek-ai/dsh-desktop-host': [
    'lib/index.js',
  ],
  // Sourcemaps stay out by payload policy; the worker-preview surface
  // (dist/preview.html and dist/preview/) backs opt-in experimental
  // packages and is not published.
  '@deepseek-ai/dsh-web-frontend': ['dist', '!dist/**/*.map', '!dist/preview.html', '!dist/preview'],
}
