/**
 * Stamp the compiled output of the two @secscan/* workspace packages the runner
 * imports (auth-gate, llm-router). In this monorepo those packages build to
 * lib/ (tsdown), not dist/, so the runner's dist-freshness guard verifies
 * lib/.src-hash. Their src/ is hashed with the SAME algorithm as dist-hash.mjs.
 *
 * Production payloads ship no src/, so distfresh skips them there; this stamp
 * exists so a source-checkout `pnpm --filter @secscan/redteam-runner test`
 * verifies the deps are fresh rather than failing with "STALE BUILD".
 */
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeStamp } from './dist-hash.mjs'

const HERE = resolve(dirname(fileURLToPath(import.meta.url)))
const DEPS = [
  { name: '@secscan/redteam-auth-gate', dir: join(HERE, '..', '..', '..', 'packages', 'redteam', 'auth-gate') },
  { name: '@secscan/redteam-llm-router', dir: join(HERE, '..', '..', '..', 'packages', 'redteam', 'llm-router') },
]

for (const dep of DEPS) {
  writeStamp(dep.dir, 'lib')
}
