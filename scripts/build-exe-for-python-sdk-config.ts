/**
 * Repository root, staging paths, and pkg manifests shared by the Python SDK executable builder.
 */

import { resolve } from 'node:path'

/** Repository root, one level above this script directory. */
export const root = resolve(import.meta.dirname, '..')

/** The closure manifest whose dependencies define the executable. */
export const DEPLOY_ROOT_PACKAGE = 'dsh-python-runtime-closure'
/** The sole executable entry inside the deployed closure. */
export const ENTRY_BIN = 'runtime-bootstrap.mjs'
/** Python-visible executable basename. */
export const OUTPUT_BASENAME = 'deepseek-harness-sdk-runtime'
/** Default Node major; SEA mode requires at least Node 22. */
export const DEFAULT_NODE_RANGE = 'node24'
/** pkg output directory, relative to {@link root}. */
export const OUT_DIR = 'dist-exe'
/** Python package destination; created when absent. */
export const PYTHON_RUNTIME_DIR = 'python/sdk-runtime/src/deepseek_harness_runtime/runtime'
/** The deployed closure doubles as the node-mode carrier. */
export const PYTHON_NODE_SUBDIR = 'node'
/** Legacy deploy may hoist peer-specialized workspace packages back here. */
export const DEPLOY_SOURCE_NODE_MODULES = 'python/sdk-runtime/node_modules'
/** Documentation excluded from the generated runtime directory. */
export const DEPLOY_ONLY_DOCS = ['README.md', 'README.zh.md', 'README.i18n.yaml']

/**
 * Whole-tree assets cover Cordis's runtime bare-package imports, which pkg's
 * static analysis cannot see. Package manifests are explicit because bare-name
 * resolution depends on them.
 */
export const ASSET_GLOBS = [
  'package.json',
  'node_modules/**/*.js',
  'node_modules/**/*.cjs',
  'node_modules/**/*.mjs',
  'node_modules/**/package.json',
  'node_modules/**/*.json',
  // Package-owned Markdown includes runtime skill instructions and badge content.
  'node_modules/**/*.md',
  'node_modules/**/*.dylib',
  'node_modules/**/*.dll',
  'node_modules/**/*.node',
  'node_modules/**/*.so',
  'node_modules/**/*.so.*',
  'node_modules/**/*.wasm',
  'node_modules/**/*.yaml',
  'node_modules/**/*.yml',
  // web-app builds this path dynamically, so pkg cannot discover the static frontend.
  'node_modules/@deepseek-ai/dsh-web-frontend/dist/**/*',
  // skill-badge resolves both Markdown and image resources through import.meta.url.
  'node_modules/@deepseek-ai/dsh-skill-badge/assets/**/*',
]
