/**
 * seclayer-dist.mjs — post-process the vendored Seclayer unit's build output.
 *
 * Background: the modules under src/seclayer/ are byte-frozen (see
 * src/seclayer/AS-IS-MANIFEST.json) and were written for the Seclayer
 * service's bundler-based build. Unlike the SecScan engine, the sources
 * already write ".js" extensions on their relative imports, so the
 * emitted dist/seclayer/** files are normally Node-ready as compiled.
 * This step is the defensive mirror of scripts/secscan-dist.mjs: it
 * verifies the unit's entry outputs exist, then rewrites any relative
 * specifier that names a sibling .js file but lacks the extension
 * (emitted .d.ts re-exports are the usual suspects). Bare specifiers
 * (node:*, undici) are left untouched — undici is a real dependency of
 * the runner and resolves from its node_modules.
 *
 * Usage (cwd = the redteam-runner workspace):
 *   node scripts/seclayer-dist.mjs
 */

import { copyFileSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER = resolve(HERE, "..");
const DIST_SECLAYER = join(RUNNER, "dist", "seclayer");

// Stage the seam-authored type shims into dist: tsc does not copy input
// .d.ts files to outDir, but the emitted declarations (and the runner's
// own seam code) reference them by their relative module paths
// (./scanner.js, ./crawler.js, …). The shims declare types only — no
// runtime module is ever loaded from them.
for (const shim of ["scanner", "crawler", "challengePage", "tlsProbe", "scanEvents"]) {
  const src = join(RUNNER, "src", "seclayer", "server", `${shim}.d.ts`);
  if (existsSync(src)) copyFileSync(src, join(DIST_SECLAYER, "server", `${shim}.d.ts`));
}

for (const entry of ["server/scoring.js", "server/redTeamProbes.js", "server/bola.js"]) {
  if (!existsSync(join(DIST_SECLAYER, entry))) {
    console.error(`seclayer-dist: dist/seclayer/${entry} missing — run \`tsc -p src/seclayer/tsconfig.json\` first`);
    process.exit(1);
  }
}

// Matches `from "..."`, `import "..."` and `import("...")` with a relative
// specifier. The quote is captured so the rewrite preserves quote style.
const SPECIFIER = /(\bfrom\s+|\bimport\s+|\bimport\s*\(\s*)(["'])(\.\.?\/[^"']+?)\2/g;

let rewrittenFiles = 0;
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    if (statSync(file).isDirectory()) {
      walk(file);
      continue;
    }
    if (!name.endsWith(".js") && !name.endsWith(".d.ts")) continue;
    const before = readFileSync(file, "utf8");
    const after = before.replace(SPECIFIER, (match, prefix, quote, spec) => {
      if (/\.(js|mjs|json|d\.ts)$/.test(spec)) return match;
      if (!existsSync(join(dirname(file), `${spec}.js`))) return match;
      return `${prefix}${quote}${spec}.js${quote}`;
    });
    if (after !== before) {
      writeFileSync(file, after);
      rewrittenFiles++;
    }
  }
};
walk(DIST_SECLAYER);

console.log(`seclayer-dist: rewrote specifiers in ${rewrittenFiles} emitted files`);
