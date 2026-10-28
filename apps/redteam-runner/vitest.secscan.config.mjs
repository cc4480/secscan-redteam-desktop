/**
 * Vitest config for the vendored SecScan engine's own test suites.
 *
 * The suites under src/secscan/ are byte-frozen with the engine (they are
 * the as-is regression proof) and import "vitest" plus the engine's three
 * bare specifiers. This config points vitest at that directory and
 * aliases pino / @workspace/db / drizzle-orm at the SAME embedded runtime
 * shims the built engine ships with (secscan-vendor/), so the suites
 * exercise the engine exactly as the runner runs it.
 *
 * Run (from the workspace root's installed vitest):
 *   node <vitest>/vitest.mjs run -c apps/redteam-runner/vitest.secscan.config.mjs
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE = join(HERE, "src", "secscan");
const VENDOR = join(HERE, "secscan-vendor");

export default {
  root: ENGINE,
  resolve: {
    alias: [
      { find: /^pino$/, replacement: join(VENDOR, "pino", "index.js") },
      { find: /^@workspace\/db$/, replacement: join(VENDOR, "@workspace", "db", "index.js") },
      { find: /^drizzle-orm$/, replacement: join(VENDOR, "drizzle-orm", "index.js") },
    ],
  },
  test: {
    include: ["*.test.ts"],
    environment: "node",
  },
};
