/** The name mapping the codemod applies, and the file extensions the generic pass scans. */

import type { Rename } from './rescope-vendor-types.ts'

/** The mapping this codemod applies; `vendor/README.md` carries the same table. */
export const RENAMES: readonly Rename[] = [
  { directory: 'cordis', upstream: 'cordis', scoped: '@deepseek-ai/cordis' },
  { directory: 'cosmokit', upstream: 'cosmokit', scoped: '@deepseek-ai/cosmokit' },
  { directory: 'schemastery', upstream: 'schemastery', scoped: '@deepseek-ai/schemastery' },
  { directory: 'loader', upstream: '@cordisjs/plugin-loader', scoped: '@deepseek-ai/cordis-plugin-loader' },
  { directory: 'include', upstream: '@cordisjs/plugin-include', scoped: '@deepseek-ai/cordis-plugin-include' },
  { directory: 'group', upstream: '@cordisjs/plugin-group', scoped: '@deepseek-ai/cordis-plugin-group' },
  { directory: 'timer', upstream: '@cordisjs/plugin-timer', scoped: '@deepseek-ai/cordis-plugin-timer' },
  { directory: 'hmr', upstream: '@cordisjs/plugin-hmr', scoped: '@deepseek-ai/cordis-plugin-hmr' },
  { directory: 'logger-console', upstream: '@cordisjs/plugin-logger-console', scoped: '@deepseek-ai/cordis-plugin-logger-console' },
]

export const EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.tpl', '.json', '.yml', '.yaml', '.md'] as const
