/**
 * Q-RP-11 — the recon seam, end to end: a local-host engagement's
 * recon phase mechanically collects the inventory through the paired
 * channel and writes host-inventory.json into the engagement dir,
 * which is exactly what the report phase reads. The channel is a stub
 * (the A2 collector suite's fixture pattern); the collector, artifact
 * mapper, report parser, and renderer under test are the real ones.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventLog } from "../src/events.js";
import { collectLocalHostInventory, type LocalCollectionContext } from "../src/phases/recon.js";
import { type LocalChannel } from "../src/local-host/collect.js";
import { LOCAL_TIER2_BLOCKS, LOCAL_TIER2_TOOL } from "../src/local-host/scripts.js";
import { type PcAgentTool } from "../src/host-exec/pc-agent.js";
import { readHostInventory } from "../src/report/host-inventory.js";
import { inventorySection } from "../src/report/html/inventory-sections.js";
import { type EngagementInput } from "../src/types.js";

const SYSTEM_INFO = JSON.stringify({
  system: "Windows", release: "11", version: "10.0.26200", machine: "AMD64",
  hostname: "CHO-ZEN1", user: "Cho-zen", cpu_percent: 12.5, mem_percent: 40,
});

type Tier2Name = keyof typeof LOCAL_TIER2_BLOCKS;

const SHELL_FIXTURES: Record<Tier2Name, string> = {
  volumes: JSON.stringify([
    { name: "C:", fileSystem: "NTFS", sizeBytes: 500_107_862_016, freeBytes: 120_440_463_360 },
    { name: "D:", fileSystem: "NTFS", sizeBytes: 2_000_398_934_016, freeBytes: 900_000_000_000 },
  ]),
  accounts: JSON.stringify([
    { name: "Cho-zen", kind: "local user", enabled: true, groups: ["Administrators", "Users"] },
    { name: "looko", kind: "local user", enabled: false, groups: ["Users"] },
  ]),
  patches: JSON.stringify([
    { id: "KB5066133", installedOn: "2026-10-12" },
    { id: "KB5065426", installedOn: "2026-09-09" },
  ]),
  software: JSON.stringify([
    { name: "Docker Desktop", version: "4.34.0", publisher: "Docker Inc." },
    { name: "Docker Desktop", version: "4.34.0", publisher: "Docker Inc." },
    { name: "Git", version: "2.47.0" },
  ]),
};

/** A stub paired channel answering the tier-0 ops and the fixed tier-2 scripts. */
function stubChannel(systemInfo: string = SYSTEM_INFO): { channel: LocalChannel; calls: string[] } {
  const calls: string[] = [];
  const answers: Record<string, string> = {
    system_info: systemInfo,
    list_processes: "{\"count\": 2, \"processes\": [{\"pid\": 4, \"exe\": \"System\"}, {\"pid\": 900, \"exe\": \"explorer.exe\", \"parent\": 4}]}",
    list_dir: "file-a.txt\nfile-b.txt",
  };
  const channel: LocalChannel = {
    async call(tool: PcAgentTool, args: Record<string, unknown>) {
      calls.push(tool);
      if (tool === LOCAL_TIER2_TOOL) {
        const name = (Object.keys(LOCAL_TIER2_BLOCKS) as Tier2Name[])
          .find((key) => LOCAL_TIER2_BLOCKS[key].script === args["script"]);
        if (name === undefined) throw new Error("stub: unknown tier-2 script");
        return JSON.stringify({ returncode: 0, stdout: SHELL_FIXTURES[name], stderr: "" });
      }
      const answer = answers[tool];
      if (answer === undefined) throw new Error(`stub has no answer for ${tool}`);
      return answer;
    },
  };
  return { channel, calls };
}

function localCtx(dir: string, over: Partial<EngagementInput> = {}): LocalCollectionContext {
  const input: EngagementInput = {
    target: "CHO-ZEN1",
    mode: "red",
    objective: "Assess this workstation",
    roe: { scope: ["CHO-ZEN1"] },
    operatorName: "Carlos",
    targets: ["windows"],
    localHost: true,
    ...over,
  };
  const events = new EventLog(dir, "eng-rp11-recon", { target: input.target, mode: input.mode, objective: input.objective });
  return { input, events };
}

describe("recon seam — local host inventory (Q-RP-11)", () => {
  let dir = "";
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "rp11-recon-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("a local engagement produces host-inventory.json the report renders from", async () => {
    const { channel, calls } = stubChannel();
    const ctx = localCtx(dir);
    assert.equal(await collectLocalHostInventory(ctx, channel), true);
    assert.ok(calls.includes("system_info"), "identity gate ran");
    assert.ok(calls.includes(LOCAL_TIER2_TOOL), "tier-2 enumeration ran");

    const artifactPath = join(dir, "host-inventory.json");
    assert.ok(existsSync(artifactPath), "artifact written into the engagement dir");
    const artifact = readHostInventory(dir);
    assert.equal(artifact?.status, "ok");
    if (artifact?.status !== "ok") return;
    assert.equal(artifact.inventory.volumes.length, 2);
    assert.equal(artifact.inventory.accounts.length, 2);
    assert.equal(artifact.inventory.patches.length, 2);
    assert.equal(artifact.inventory.software.length, 2, "duplicate hive rows counted once");
    const html = inventorySection(artifact);
    assert.ok(html.includes("2 volumes · 2 accounts · 2 hotfixes · 2 software entries"));
    assert.ok(html.includes("Docker Desktop"));
    assert.ok(html.includes("explorer.exe"), "the collected process list renders");
    assert.ok(!html.includes("Not collected"), "a full collection has no fallback states");
  });

  it("a remote engagement is untouched: no collection, no artifact", async () => {
    const { channel, calls } = stubChannel();
    const ctx = localCtx(dir, { localHost: undefined });
    assert.equal(await collectLocalHostInventory(ctx, channel), false);
    assert.deepEqual(calls, []);
    assert.ok(!existsSync(join(dir, "host-inventory.json")));
    assert.equal(readHostInventory(dir), undefined);
  });

  it("an unconfigured bridge writes the failed form — the report says so honestly", async () => {
    const savedUrl = process.env["REDTEAM_PC_AGENT_URL"];
    const savedToken = process.env["REDTEAM_PC_AGENT_TOKEN"];
    delete process.env["REDTEAM_PC_AGENT_URL"];
    delete process.env["REDTEAM_PC_AGENT_TOKEN"];
    try {
      const ctx = localCtx(dir);
      assert.equal(await collectLocalHostInventory(ctx), true);
    } finally {
      if (savedUrl === undefined) delete process.env["REDTEAM_PC_AGENT_URL"];
      else process.env["REDTEAM_PC_AGENT_URL"] = savedUrl;
      if (savedToken === undefined) delete process.env["REDTEAM_PC_AGENT_TOKEN"];
      else process.env["REDTEAM_PC_AGENT_TOKEN"] = savedToken;
    }
    const artifact = readHostInventory(dir);
    assert.equal(artifact?.status, "failed");
    if (artifact?.status !== "failed") return;
    assert.match(artifact.error, /not configured/);
    assert.ok(inventorySection(artifact).includes("did not complete"));
  });

  it("a hostname mismatch lands in the artifact's failed form, never as inventory", async () => {
    const foreign = JSON.stringify({ ...JSON.parse(SYSTEM_INFO) as object, hostname: "SOMEONE-ELSE" });
    const { channel } = stubChannel(foreign);
    const ctx = localCtx(dir);
    assert.equal(await collectLocalHostInventory(ctx, channel), true);
    const artifact = readHostInventory(dir);
    assert.equal(artifact?.status, "failed");
  });
});
