/**
 * Arsenal serving resolution (FIX-CONSOLE-PAGES).
 *
 * The console binds ONE arsenal config for its MCP surface. At base the
 * bound path is only ever the engagements-dir derivation
 * (<userData>/arsenal/arsenal.db on the desktop). A real index that lives
 * at the runner's own data-home convention ($REDTEAM_HOME/arsenal/
 * arsenal.db — where the production census is built and where a
 * standalone console resolves it) is invisible to the bound surface, so
 * the Arsenal page renders an empty census while a real index exists.
 *
 * The serving resolution therefore picks, in order: the explicit
 * REDTEAM_ARSENAL_DB_PATH override, the engagements-dir derivation (the
 * desktop's canonical home — a refreshed index there wins), then the
 * first EXISTING index at the data-home conventions ($REDTEAM_HOME, then
 * the console cwd). When no index exists anywhere, the primary derived
 * path stands, so the tools keep answering the typed ARSENAL_INDEX_EMPTY
 * result and a refresh still creates the index at the canonical path.
 * Refresh itself always resolves the primary config — serving fallback
 * never redirects a write.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveArsenalConfig,
  resolveArsenalServingConfig,
} from "../src/arsenal/config.js";
import { buildAndSwapArsenalIndex } from "../src/arsenal/index-store.js";
import { ARSENAL_TOOLS_BY_NAME, bindArsenalConfig } from "../src/arsenal/tools.js";
import type { ArsenalBuildData } from "../src/arsenal/index-store.js";

const BUILT_AT = "2026-11-01T12:00:00.000Z";

function fixtureData(): ArsenalBuildData {
  return {
    sourceRepo: "https://example.invalid/awesome-hacking.git",
    sourceCommit: "fixturecommit123",
    builtAt: BUILT_AT,
    unparsedCount: 0,
    dupeCount: 0,
    prioritySlugs: ["seclists"],
    collections: [
      {
        slug: "seclists",
        name: "SecLists",
        url: "https://example.invalid/seclists",
        description: "Wordlists for testing.",
        topic: "Wordlists",
        fetchedAt: BUILT_AT,
        entryCount: 1,
        fetchError: null,
      },
      {
        slug: "payloadsallthethings",
        name: "PayloadsAllTheThings",
        url: "https://example.invalid/payloadsallthethings",
        description: "Payloads and bypasses.",
        topic: "Web Hacking",
        fetchedAt: BUILT_AT,
        entryCount: 1,
        fetchError: null,
      },
    ],
    entries: [
      {
        name: "JWT Wordlist",
        url: "https://example.invalid/seclists/jwt-wordlist",
        description: "Wordlist of common JWT secrets for token forgery tests.",
        collectionSlug: "seclists",
        tags: ["topic:wordlists", "collection:seclists", "wordlist"],
        targets: ["WA"],
        battery: ["F-10", "functionality"],
      },
      {
        name: "SSRF Payloads",
        url: "https://example.invalid/payloadsallthethings/ssrf",
        description: "Server-side request forgery payloads for internal service probing.",
        collectionSlug: "payloadsallthethings",
        tags: ["topic:web-hacking", "collection:payloadsallthethings", "payloads"],
        targets: ["WA"],
        battery: ["F-9"],
      },
    ],
  };
}

let base = "";
let userData = "";
let home = "";
let engagementsDir = "";
let savedCwd = "";

function buildIndexAt(dbPath: string): void {
  mkdirSync(dirname(dbPath), { recursive: true });
  const built = buildAndSwapArsenalIndex(dbPath, fixtureData());
  assert.equal(built.generation, 1);
}

async function toolJson(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const tool = ARSENAL_TOOLS_BY_NAME.get(name);
  assert.ok(tool, `tool ${name} registered`);
  return JSON.parse(await tool.run(args)) as Record<string, unknown>;
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "arsenal-serving-"));
  userData = join(base, "userData");
  home = join(base, "redteam-home");
  engagementsDir = join(userData, "engagements", "live");
  savedCwd = process.cwd();
  process.chdir(join(base));
});

afterEach(() => {
  process.chdir(savedCwd);
  rmSync(base, { recursive: true, force: true });
});

describe("arsenal serving resolution", () => {
  it("serves the real index at the REDTEAM_HOME convention when the derived desktop path has none", async () => {
    const homeDb = join(home, "arsenal", "arsenal.db");
    buildIndexAt(homeDb);
    const env = { REDTEAM_HOME: home };

    // The primary (refresh/write) resolution is unchanged: canonical path.
    assert.equal(
      resolveArsenalConfig(env, { engagementsDir }).dbPath,
      join(userData, "arsenal", "arsenal.db"),
    );
    // The serving resolution finds the index that actually exists.
    const serving = resolveArsenalServingConfig(env, { engagementsDir });
    assert.equal(serving.dbPath, homeDb);

    bindArsenalConfig(serving);
    const browse = await toolJson("arsenal_browse", {});
    const topics = browse["topics"] as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(topics), `browse answered no census: ${JSON.stringify(browse)}`);
    assert.equal(topics.length, 2);
    assert.equal(topics.reduce((n, t) => n + (t["entries"] as number), 0), 2);

    const category = await toolJson("arsenal_browse", { category: "Wordlists" });
    const collections = category["collections"] as Array<Record<string, unknown>>;
    assert.equal(collections.length, 1);
    assert.equal(collections[0]?.["slug"], "seclists");

    const search = await toolJson("arsenal_search", { query: "JWT" });
    assert.equal(search["total"], 1);

    const recommend = await toolJson("arsenal_recommend", { task: "ssrf probing" });
    assert.ok((recommend["total"] as number) >= 1, "recommend hits the same index");
  });

  it("the derived desktop path wins once a refresh has built an index there", () => {
    buildIndexAt(join(home, "arsenal", "arsenal.db"));
    const derivedDb = join(userData, "arsenal", "arsenal.db");
    buildIndexAt(derivedDb);
    const serving = resolveArsenalServingConfig({ REDTEAM_HOME: home }, { engagementsDir });
    assert.equal(serving.dbPath, derivedDb);
  });

  it("an explicit REDTEAM_ARSENAL_DB_PATH override always wins", () => {
    const overrideDb = join(base, "elsewhere", "arsenal.db");
    buildIndexAt(overrideDb);
    buildIndexAt(join(home, "arsenal", "arsenal.db"));
    const serving = resolveArsenalServingConfig(
      { REDTEAM_HOME: home, REDTEAM_ARSENAL_DB_PATH: overrideDb },
      { engagementsDir },
    );
    assert.equal(serving.dbPath, overrideDb);
  });

  it("no index anywhere: serving keeps the canonical derived path and the tools answer the typed empty result", async () => {
    const serving = resolveArsenalServingConfig({ REDTEAM_HOME: home }, { engagementsDir });
    assert.equal(serving.dbPath, join(userData, "arsenal", "arsenal.db"));
    bindArsenalConfig(serving);
    const browse = await toolJson("arsenal_browse", {});
    const error = browse["error"] as Record<string, unknown>;
    assert.equal(error["code"], "ARSENAL_INDEX_EMPTY");
  });
});
