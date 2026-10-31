/**
 * Q-MEMTIER wiring tests — the §2.3 integration seams, re-created with
 * the wiring (harvest 3C). The memory module's own suites test the
 * store/recall/commit machinery; these tests pin the RUN-level seams:
 * config resolution of the memory root, the §8 row-1 registry fail-loud,
 * the §8 row-2 corrupt-store fail-fast, and the §7.2 receipt attached
 * to EngagementResult for the complete and blocked outcomes (the
 * halted return site assigns the same hoisted result the finally
 * block attaches to; no dry-run seam reaches it — see harvest log).
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runEngagement, resolveConfig } from "../src/phases.js";
import { readEvents } from "../src/events.js";
import { memoryBlock, type PromptContext } from "../src/prompts/shared.js";
import { MemoryError } from "../src/memory/index.js";
import type { EngagementInput } from "../src/types.js";

const noVerify = async () => false;
const yesVerify = async () => true;

function input(): EngagementInput {
  return {
    target: "secscan.us",
    mode: "red",
    objective: "test objective",
    roe: { scope: ["secscan.us"] },
  };
}

describe("resolveConfig memoryRoot (§3.1)", () => {
  it("defaults to the registry file's sibling memory dir", () => {
    const home = join(tmpdir(), "rt-mem-root-default");
    const config = resolveConfig({ MODEL_API_KEY: "test", REDTEAM_HOME: home }, {});
    assert.equal(config.registryPath, join(home, "engagements", "registry.json"));
    assert.equal(config.memoryRoot, join(home, "engagements", "memory"));
  });

  it("REDTEAM_MEMORY_ROOT wins over the sibling default", () => {
    const config = resolveConfig(
      { MODEL_API_KEY: "test", REDTEAM_HOME: join(tmpdir(), "rt-mem-root-env"), REDTEAM_MEMORY_ROOT: "/env/memory" },
      {},
    );
    assert.equal(config.memoryRoot, "/env/memory");
  });

  it("the explicit override wins over the env value", () => {
    const config = resolveConfig(
      { MODEL_API_KEY: "test", REDTEAM_MEMORY_ROOT: "/env/memory" },
      { memoryRoot: "/opt/memory" },
    );
    assert.equal(config.memoryRoot, "/opt/memory");
  });

  it("an empty REDTEAM_MEMORY_ROOT fails loud, naming the variable", () => {
    assert.throws(
      () => resolveConfig({ MODEL_API_KEY: "test", REDTEAM_MEMORY_ROOT: "  " }, {}),
      (err: unknown) =>
        err instanceof MemoryError && err.code === "SCHEMA_INVALID" && /REDTEAM_MEMORY_ROOT/.test(err.message),
    );
  });
});

describe("memoryBlock (prompt surface)", () => {
  const base: PromptContext = {
    mode: "red",
    objective: "test objective",
    target: "secscan.us",
    scopeHosts: ["secscan.us"],
    roe: { scope: ["secscan.us"] },
  };

  it("renders nothing when no brief was recalled", () => {
    assert.equal(memoryBlock(base), "");
  });

  it("renders the pack text with the standing instruction", () => {
    const block = memoryBlock({ ...base, memoryBrief: "PACK-TEXT-MARKER" });
    assert.match(block, /PACK-TEXT-MARKER/);
    assert.match(block, /CLAIMS TO TEST/);
    assert.match(block, /never widens your scope/);
  });
});

describe("runEngagement memory wiring (dry-run agents)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rt-mem-wiring-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const opts = (verify: typeof noVerify) => ({
    modelApiKey: "test",
    engagementsDir: dir,
    registryPath: join(dir, "registry.json"),
    dryRunAgents: true,
    deps: { verify },
  });

  it("first engagement on an empty store completes with a NO_ELIGIBLE_UNITS pack and a commit receipt", async () => {
    const res = await runEngagement(input(), opts(yesVerify));
    assert.equal(res.status, "complete");
    assert.ok(res.memory, "memory receipt is attached to the complete result");
    assert.equal(res.memory.recallReceiptIds.length, 2, "start + refresh recall receipts");
    assert.notEqual(res.memory.commit.status, "failed");
    const engDir = join(dir, res.engagementId);
    assert.ok(existsSync(join(engDir, "memory-receipt.json")), "receipt mirrored into the engagement dir");
    const memoryRoot = join(dir, "memory");
    assert.ok(existsSync(join(memoryRoot, "manifest.json")), "store bootstrapped at the resolved root");
    assert.ok(existsSync(join(memoryRoot, "recall", `${res.engagementId}-start.json`)), "start recall receipt on disk");
    const events = readEvents(engDir);
    const recalls = events.filter((e) => e.action === "memory_recall");
    assert.equal(recalls.length, 2);
    assert.match(recalls[0]!.result, /NO_ELIGIBLE_UNITS/);
    assert.ok(events.some((e) => e.action === "memory_commit"));
  });

  it("blocked engagement archives with recall recorded as skipped-authorization-denied", async () => {
    const res = await runEngagement(input(), opts(noVerify));
    assert.equal(res.status, "blocked");
    assert.ok(res.memory, "memory receipt is attached to the blocked result");
    assert.deepEqual(res.memory.recallReceiptIds, []);
    const engDir = join(dir, res.engagementId);
    assert.ok(existsSync(join(engDir, "memory-receipt.json")), "blocked run still archives");
    const events = readEvents(engDir);
    assert.ok(
      events.some((e) => e.action === "memory_recall" && /skipped-authorization-denied/.test(e.result)),
      "the archive records that recall was skipped, not silently absent",
    );
  });

  it("a registry file that exists but does not load fails loud (REGISTRY_UNREADABLE) and is never overwritten", async () => {
    const registryPath = join(dir, "registry.json");
    writeFileSync(registryPath, "{ this is not a registry");
    await assert.rejects(
      () => runEngagement(input(), opts(yesVerify)),
      (err: unknown) =>
        err instanceof MemoryError && err.code === "REGISTRY_UNREADABLE" && err.message.includes(registryPath),
    );
    assert.equal(readFileSync(registryPath, "utf8"), "{ this is not a registry", "seeding must not clobber the corrupt file");
  });

  it("a corrupt memory store fails the engagement before authorization (STORE_CORRUPT)", async () => {
    const memoryRoot = join(dir, "memory");
    mkdirSync(memoryRoot, { recursive: true });
    writeFileSync(join(memoryRoot, "manifest.json"), "{ not a manifest");
    await assert.rejects(
      () => runEngagement(input(), { ...opts(yesVerify), memoryRoot }),
      (err: unknown) => err instanceof MemoryError && err.code === "STORE_CORRUPT",
    );
  });
});
