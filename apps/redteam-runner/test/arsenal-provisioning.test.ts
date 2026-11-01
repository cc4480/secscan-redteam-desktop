/**
 * Arsenal provisioning, served surface (ARSENAL-PROVISIONING).
 *
 * The desktop ships one reviewed census build as its Arsenal seed
 * (apps/desktop/resources/arsenal/arsenal.db, pinned by
 * apps/desktop/resources/arsenal-manifest.json) and materializes it at the
 * canonical `<userData>/arsenal/arsenal.db` on first run; the desktop spec
 * (apps/desktop/tests/arsenal-provisioning.spec.ts) proves that copy is
 * byte-identical to the seed. This suite proves the other half of the chain
 * with the real handlers bound exactly as the MCP endpoint binds them: a
 * profile whose canonical path holds the seed serves the recorded census —
 * 82 collections, 1,039 entries — while the same fresh profile with nothing
 * provisioned answers the typed ARSENAL_INDEX_EMPTY result. That second half
 * is also the pre-provisioning behavior: before the seed shipped, every
 * fresh install lived in it permanently.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { resolveArsenalServingConfig } from "../src/arsenal/config.js";
import { ARSENAL_TOOLS_BY_NAME, bindArsenalConfig } from "../src/arsenal/tools.js";

/** Walk up from this file until the repo root (the dir holding both apps) appears. */
function repoRoot(): string {
  let level = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth += 1) {
    if (
      existsSync(join(level, "apps", "desktop", "resources", "arsenal-manifest.json")) &&
      existsSync(join(level, "apps", "redteam-runner", "package.json"))
    ) {
      return level;
    }
    level = dirname(level);
  }
  throw new Error("arsenal-provisioning.test: repo root not found above the test file");
}

const root = repoRoot();
const seedPath = join(root, "apps", "desktop", "resources", "arsenal", "arsenal.db");
const manifestPath = join(root, "apps", "desktop", "resources", "arsenal-manifest.json");

interface SeedManifest {
  seeds: Array<{ file?: string; sha256?: string; entries?: number; collections?: number }>;
}

let base = "";
let userData = "";
let engagementsDir = "";
let savedCwd = "";

async function toolJson(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const tool = ARSENAL_TOOLS_BY_NAME.get(name);
  assert.ok(tool, `tool ${name} registered`);
  return JSON.parse(await tool.run(args)) as Record<string, unknown>;
}

/** Bind the tools the way the console's MCP endpoint binds them (ui/mcp-endpoint.ts). */
function bindForProfile(): void {
  bindArsenalConfig(resolveArsenalServingConfig({}, { engagementsDir }));
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "arsenal-provisioning-"));
  userData = join(base, "userData");
  engagementsDir = join(userData, "engagements", "live");
  mkdirSync(engagementsDir, { recursive: true });
  // The serving resolution's last fallback is the console cwd; park the
  // process in an empty directory so only the canonical path can serve.
  const cwd = join(base, "cwd");
  mkdirSync(cwd, { recursive: true });
  savedCwd = process.cwd();
  process.chdir(cwd);
});

afterEach(() => {
  process.chdir(savedCwd);
  rmSync(base, { recursive: true, force: true });
});

describe("arsenal provisioning — served surface", () => {
  it("serves the recorded census from a provisioned fresh profile", async () => {
    // The shipped seed is the pinned one — the same verification the desktop
    // performs before it copies anything.
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as SeedManifest;
    const seed = manifest.seeds.find((entry) => entry.file === "arsenal.db");
    assert.ok(seed, "manifest pins an arsenal.db seed");
    const seedBytes = readFileSync(seedPath);
    assert.equal(createHash("sha256").update(seedBytes).digest("hex"), seed.sha256);
    assert.equal(seed.entries, 1039);
    assert.equal(seed.collections, 82);

    // The provisioned state: the seed at the canonical path, byte-for-byte
    // (the state apps/desktop's provisionArsenalIndex produces on first run).
    const canonical = join(userData, "arsenal", "arsenal.db");
    mkdirSync(dirname(canonical), { recursive: true });
    copyFileSync(seedPath, canonical);
    bindForProfile();

    const browse = await toolJson("arsenal_browse", {});
    const topics = browse["topics"] as Array<{ topic: string; collections: number; entries: number }>;
    assert.ok(Array.isArray(topics), "browse answers its topics view");
    assert.equal(
      topics.reduce((sum, topic) => sum + topic.collections, 0),
      82,
      "browse counts every collection in the census",
    );
    assert.equal(
      topics.reduce((sum, topic) => sum + topic.entries, 0),
      1039,
      "browse counts every entry in the census",
    );

    const category = await toolJson("arsenal_browse", { category: "Awesome Repositories" });
    const collections = category["collections"] as Array<{ slug: string }>;
    assert.equal(collections.length, 47, "the largest topic lists its collections");

    const search = await toolJson("arsenal_search", { query: "nmap" });
    const results = search["results"] as Array<{ name: string }>;
    assert.ok(
      results.some((entry) => entry.name === "nmap"),
      "search finds the census's nmap entry",
    );
    assert.ok(Number(search["total"]) >= 1, "search reports its total");
  });

  it("answers ARSENAL_INDEX_EMPTY for the same profile with nothing provisioned", async () => {
    bindForProfile();
    const browse = await toolJson("arsenal_browse", {});
    assert.deepEqual(browse, {
      error: { code: "ARSENAL_INDEX_EMPTY", fix: "Run: redteam-runner arsenal refresh" },
    });
    const search = await toolJson("arsenal_search", { query: "nmap" });
    assert.deepEqual(search, {
      error: { code: "ARSENAL_INDEX_EMPTY", fix: "Run: redteam-runner arsenal refresh" },
    });
  });
});
