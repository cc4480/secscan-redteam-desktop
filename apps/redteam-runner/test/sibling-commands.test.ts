/**
 * S2-H2: sibling command semantics survive into the engagement that runs.
 *
 * The command registry (workflows/commands.ts) defines each sibling's
 * tier, phase list, and target families; on the audited base every one
 * of those semantics was dropped on both launch surfaces — the CLI built
 * its EngagementInput from target/mode/objective/roe/targets only, and
 * the chat launch body had no command/targets/phases carrier at all — so
 * /nmap ran the full exploit pipeline at the default tier and a chat
 * /metasploit was indistinguishable from /scan. These tests pin the
 * carried semantics end to end: CLI builder → EngagementInput →
 * runEngagement (dry-run agents, fake gate), and chat buildLaunchBody →
 * toEngagementInput.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildLocalEngagementInput,
  parseCommand,
} from "../src/workflows/commands.js";
import { buildCommandEngagementInput } from "../src/cli/command.js";
import { runEngagement } from "../src/phases.js";
import { readEvents } from "../src/events.js";
import { TOOLS_BY_NAME } from "../src/ui/mcp-tools.js";
import { buildLaunchBody } from "../src/ui/engagement-tools.js";
import { toEngagementInput } from "../src/ui/routes/engagements.js";

const yesVerify = async () => true;

describe("CLI command input carries the command spec", () => {
  it("/nmap builds a tier-0 recon+report input", () => {
    const parsed = parseCommand("/nmap 10.0.0.5");
    assert.notEqual(typeof parsed, "string");
    if (typeof parsed === "string") return;
    const input = buildCommandEngagementInput(parsed, "10.0.0.5", "red", { scope: ["10.0.0.5"] });
    assert.equal(input.tier, 0);
    assert.deepEqual(input.phases, ["recon", "report"]);
    assert.deepEqual(input.targets, ["windows", "linux"]);
    assert.equal(input.target, "10.0.0.5");
    assert.match(input.objective, /\(\/nmap\)$/);
  });

  it("/metasploit builds a tier-2 full-pipeline input and stays approval-gated in the registry", () => {
    const parsed = parseCommand("/metasploit 10.0.0.5");
    assert.notEqual(typeof parsed, "string");
    if (typeof parsed === "string") return;
    assert.equal(parsed.command.tier, 2);
    assert.equal(parsed.command.requiresApproval, true);
    const input = buildCommandEngagementInput(parsed, "10.0.0.5", "red", { scope: ["10.0.0.5"] });
    assert.equal(input.tier, 2);
    assert.deepEqual(input.phases, ["recon", "exploit", "report"]);
  });

  it("/scan builds its spec input (tier 1, full pipeline)", () => {
    const parsed = parseCommand("/scan secscan.us");
    assert.notEqual(typeof parsed, "string");
    if (typeof parsed === "string") return;
    const input = buildCommandEngagementInput(parsed, "secscan.us", "red", { scope: ["secscan.us"] });
    assert.equal(input.tier, 1);
    assert.deepEqual(input.phases, ["recon", "exploit", "report"]);
  });

  it("/pcscan's local input carries its tier and phases too", () => {
    const parsed = parseCommand("/pcscan full");
    assert.notEqual(typeof parsed, "string");
    if (typeof parsed === "string") return;
    const input = buildLocalEngagementInput(parsed, "TESTBOX");
    assert.equal(input.tier, 1);
    assert.deepEqual(input.phases, ["recon", "exploit", "report"]);
    assert.equal(input.localHost, true);
  });
});

describe("runEngagement honours the phases field", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rt-sibling-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const opts = () => ({
    mcpToken: "test",
    deepseekApiKey: "test",
    qwenApiKey: "test",
    engagementsDir: dir,
    registryPath: join(dir, "registry.json"),
    dryRunAgents: true,
    deps: { verify: yesVerify },
  });

  it("a recon+report command completes WITHOUT entering the exploit phase, at its own tier", async () => {
    const parsed = parseCommand("/nmap secscan.us");
    assert.notEqual(typeof parsed, "string");
    if (typeof parsed === "string") return;
    const input = buildCommandEngagementInput(parsed, "secscan.us", "red", { scope: ["secscan.us"] });
    const res = await runEngagement(input, opts());
    assert.equal(res.status, "complete");
    const events = readEvents(join(dir, res.engagementId));
    assert.ok(!events.some((e) => e.phase === "exploit"), "no exploit-phase event was recorded");
    assert.ok(!events.some((e) => e.action === "exploit_summary"), "exploitPhase never ran");
    assert.ok(
      !events.some((e) => e.action === "signoff" && /recon→exploit|exploit→report/.test(e.result)),
      "no exploit-bound sign-off gate ran",
    );
    assert.ok(events.some((e) => e.phase === "report"), "the report phase still ran");
    const tierFile = JSON.parse(readFileSync(join(dir, res.engagementId, "tier.json"), "utf8")) as { tier?: number };
    assert.equal(tierFile.tier, 0);
  });

  it("a plain full-pipeline input still runs the exploit phase exactly as before", async () => {
    const res = await runEngagement(
      { target: "secscan.us", mode: "red", objective: "test objective", roe: { scope: ["secscan.us"] } },
      opts(),
    );
    assert.equal(res.status, "complete");
    const events = readEvents(join(dir, res.engagementId));
    assert.ok(events.some((e) => e.action === "exploit_summary"), "exploitPhase ran for an unrestricted input");
  });
});

describe("chat launch carries the sibling command", () => {
  it("engagement_launch's schema exposes command and targets", () => {
    const launch = TOOLS_BY_NAME.get("engagement_launch");
    assert.ok(launch);
    const props = launch.inputSchema["properties"];
    assert.ok(typeof props === "object" && props !== null, "schema carries properties");
    if (typeof props !== "object" || props === null) return;
    assert.ok("command" in props, "command is a launch argument");
    assert.ok("targets" in props, "targets is a launch argument");
    assert.ok("tier" in props, "tier is a launch argument");
  });

  it("/nmap's body is stamped from the registry spec and survives toEngagementInput", () => {
    const built = buildLaunchBody({ target: "https://example.com", objective: "run /nmap", command: "nmap" });
    assert.ok("body" in built);
    if (!("body" in built)) return;
    assert.equal(built.body.command, "nmap");
    assert.equal(built.body.tier, 0);
    assert.deepEqual(built.body.targets, ["windows", "linux"]);
    assert.deepEqual(built.body.phases, ["recon", "report"]);
    const input = toEngagementInput(built.body);
    assert.equal(input.tier, 0);
    assert.deepEqual(input.targets, ["windows", "linux"]);
    assert.deepEqual(input.phases, ["recon", "report"]);
  });

  it("/metasploit keeps tier 2 through the chat launch path", () => {
    const built = buildLaunchBody({ target: "https://example.com", objective: "run /metasploit", command: "/metasploit" });
    assert.ok("body" in built);
    if (!("body" in built)) return;
    assert.equal(built.body.command, "metasploit");
    assert.equal(built.body.tier, 2);
    assert.deepEqual(built.body.phases, ["recon", "exploit", "report"]);
    const input = toEngagementInput(built.body);
    assert.equal(input.tier, 2);
    assert.deepEqual(input.phases, ["recon", "exploit", "report"]);
  });

  it("an explicit tier/targets argument overrides the command's defaults", () => {
    const built = buildLaunchBody({
      target: "https://example.com",
      objective: "run /nmap",
      command: "nmap",
      tier: 1,
      targets: ["webapp"],
    });
    assert.ok("body" in built);
    if (!("body" in built)) return;
    assert.equal(built.body.tier, 1);
    assert.deepEqual(built.body.targets, ["webapp"]);
    assert.deepEqual(built.body.phases, ["recon", "report"]);
  });

  it("an unknown command name stamps nothing — the launch stays a plain scan", () => {
    const built = buildLaunchBody({ target: "https://example.com", objective: "scan it", command: "bogus" });
    assert.ok("body" in built);
    if (!("body" in built)) return;
    assert.equal(built.body.command, undefined);
    assert.equal(built.body.tier, undefined);
    assert.equal(built.body.targets, undefined);
    assert.equal(built.body.phases, undefined);
  });

  it("a plain /scan launch body is exactly what it was before (no command fields)", () => {
    const built = buildLaunchBody({ target: "https://secscan.us,", objective: "full deep scan" });
    assert.ok("body" in built);
    if (!("body" in built)) return;
    assert.equal(built.body.command, undefined);
    assert.equal(built.body.phases, undefined);
    assert.equal(built.body.targets, undefined);
    const input = toEngagementInput(built.body);
    assert.equal(input.phases, undefined);
    assert.equal(input.fullBattery, true);
  });
});
