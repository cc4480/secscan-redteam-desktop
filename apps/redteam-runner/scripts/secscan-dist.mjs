/**
 * secscan-dist.mjs — post-process the vendored SecScan engine's build output.
 *
 * Background: the engine under src/secscan/ is byte-frozen (see
 * src/secscan/AS-IS-MANIFEST.json) and was written for the SecScan
 * service's bundler-based build, which used extensionless relative
 * imports ("./scoring"). TypeScript compiles it with moduleResolution
 * Bundler, so the emitted dist/secscan/*.js and *.d.ts keep those
 * extensionless specifiers — and plain Node ESM refuses them. The
 * sources cannot be edited, so this step rewrites the EMITTED files
 * only: a relative specifier that names a sibling .js file gains its
 * ".js" extension. Bare specifiers (node:*, pino, @workspace/db,
 * drizzle-orm) are left untouched.
 *
 * It also stages the embedded runtime shims: secscan-vendor/ holds the
 * pino / @workspace/db / drizzle-orm stand-ins the engine imports, and
 * they are copied into dist/secscan/node_modules/ so Node's resolution
 * from the engine's own directory finds them first.
 *
 * Usage (cwd = the redteam-runner workspace):
 *   node scripts/secscan-dist.mjs
 */

import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER = resolve(HERE, "..");
const DIST_SECSCAN = join(RUNNER, "dist", "secscan");
const VENDOR = join(RUNNER, "secscan-vendor");

if (!existsSync(join(DIST_SECSCAN, "scanner.js"))) {
  console.error("secscan-dist: dist/secscan/scanner.js missing — run `tsc -p src/secscan/tsconfig.json` first");
  process.exit(1);
}

// Matches `from "..."`, `import "..."` and `import("...")` with a relative
// specifier. The quote is captured so the rewrite preserves quote style.
const SPECIFIER = /(\bfrom\s+|\bimport\s+|\bimport\s*\(\s*)(["'])(\.\.?\/[^"']+?)\2/g;

let rewrittenFiles = 0;
for (const name of readdirSync(DIST_SECSCAN)) {
  if (!name.endsWith(".js") && !name.endsWith(".d.ts")) continue;
  const file = join(DIST_SECSCAN, name);
  const before = readFileSync(file, "utf8");
  const after = before.replace(SPECIFIER, (match, prefix, quote, spec) => {
    if (/\.(js|mjs|json|d\.ts)$/.test(spec)) return match;
    if (!existsSync(join(DIST_SECSCAN, `${spec}.js`))) return match;
    return `${prefix}${quote}${spec}.js${quote}`;
  });
  if (after !== before) {
    writeFileSync(file, after);
    rewrittenFiles++;
  }
}

const shimDest = join(DIST_SECSCAN, "node_modules");
rmSync(shimDest, { recursive: true, force: true });
cpSync(VENDOR, shimDest, { recursive: true });

console.log(`secscan-dist: rewrote specifiers in ${rewrittenFiles} emitted files; staged runtime shims into dist/secscan/node_modules`);
