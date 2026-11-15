/** The strings that must appear a required number of times once the rescope has run. */

import type { PostCondition } from './rescope-vendor-types.ts'

export const POSTCONDITIONS: readonly PostCondition[] = [
  { file: 'vendor/cordis/package.json', text: '"name": "@deepseek-ai/cordis"', count: 1 },
  { file: 'vendor/hmr/package.json', text: '"name": "@deepseek-ai/cordis-plugin-hmr"', count: 1 },
  { file: 'scripts/cordis-walk.ts', text: '@deepseek-ai\\/cordis', count: 1 },
  { file: 'scripts/cordis-walk.ts', text: '!== \'@deepseek-ai/cordis\'', count: 1 },
  { file: 'scripts/gen-scoped-events.ts', text: '=== \'@deepseek-ai/cordis\'', count: 1 },
  { file: 'packages/typert/generator/src/analyzer.ts', text: '!== \'@deepseek-ai/cordis\'', count: 2 },
  { file: 'scripts/workspace-release-checks.ts', text: '?.[\'@deepseek-ai/cordis\']', count: 2 },
  { file: 'packages/boot/app-boot/tsdown.config.ts', text: '[\'@deepseek-ai/cordis-plugin-include\']', count: 1 },
  { file: 'tsconfig.base.json', text: '"@deepseek-ai/cordis-plugin-loader": ["./vendor/loader/src"]', count: 1 },
  // The vendored README owns this required entry; reject its deletion or duplication.
  { file: 'vendor/README.md', text: '17. **`@deepseek-ai` rescope**', count: 1 },
  { file: 'pnpm-workspace.yaml', text: 'cordis@4.0.0-rc.7', count: 0 },
  // The preset ids in this table are product data, not package names.
  { file: 'packages/client/ui-agent-preset/tests/locales.client.spec.ts', text: '[\'cordis\', \'presetCordisName\'', count: 1 },
  // The preset id the shipped composition documents to its own model.
]
