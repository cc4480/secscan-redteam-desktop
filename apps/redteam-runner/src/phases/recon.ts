/**
 * Reconnaissance phase (v0.19.0 refactor — extracted from phases.ts).
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Ctx } from "../context.js";
import { type EventLog } from "../events.js";
import { pcAgentConfig } from "../host-exec/pc-agent.js";
import { collectLocalInventory, localChannelFromEnv, type LocalChannel } from "../local-host/collect.js";
import { HOST_INVENTORY_ARTIFACT, writeHostInventoryArtifact } from "../local-host/artifact.js";
import { type EngagementInput } from "../types.js";
import { RECON_TOOLS } from "../tools.js";
import { withBridgeTools } from "../dispatch/bridge-gate.js";
import { agentLoop, promptCtx } from "../agents.js";
import { reconPrompt } from "../prompts.js";

/** The slice of the engagement context the local collection seam needs. */
export interface LocalCollectionContext {
  input: EngagementInput;
  events: Pick<EventLog, "dir" | "append">;
}

/** Write the artifact's failed form directly (no collector record exists). */
async function writeFailedInventoryArtifact(dir: string, hostname: string, error: string): Promise<void> {
  const artifact = { status: "failed", hostname, collectedAt: new Date().toISOString(), error };
  await writeFile(join(dir, HOST_INVENTORY_ARTIFACT), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
}

/**
 * Q-RP-11 recon seam: for a LOCAL-host engagement, collect the host
 * inventory mechanically through the paired pc-agent channel and write
 * host-inventory.json into the engagement dir — the exact file the
 * report phase reads (report/html/wire.ts). Runs before the recon
 * agent, so the inventory exists whatever the agents do next.
 *
 * Failure is data, not a halt: an unconfigured bridge or a failed
 * collection writes the artifact's `failed` form and recon continues —
 * the report then states the failure honestly instead of rendering no
 * section (which would read as "nothing to report"). Remote
 * engagements are untouched: no artifact, no section.
 * @param ctx - the engagement context (or its local-collection slice).
 * @param channel - collector channel seam for tests; defaults to the
 * env-configured paired bridge channel.
 * @returns true when the engagement is local (artifact written),
 * false when it is not.
 */
export async function collectLocalHostInventory(
  ctx: LocalCollectionContext,
  channel?: LocalChannel,
): Promise<boolean> {
  if (ctx.input.localHost !== true) return false;
  const hostname = ctx.input.target;
  const ch = channel ?? localChannelFromEnv();
  if (ch === undefined) {
    const error =
      "local inventory collection unavailable: the pc-agent bridge is not configured " +
      "on this machine (REDTEAM_PC_AGENT_URL / REDTEAM_PC_AGENT_TOKEN unset)";
    await writeFailedInventoryArtifact(ctx.events.dir, hostname, error);
    ctx.events.append({ phase: "recon", actor: "runner", action: "local_inventory_failed", result: error });
    return true;
  }
  try {
    const inventory = await collectLocalInventory(ch, {
      declaredHostname: hostname,
      ...(ctx.input.operatorName ? { operatorName: ctx.input.operatorName } : {}),
      channelUrl: pcAgentConfig()?.url ?? "pc-agent",
    });
    await writeHostInventoryArtifact(ctx.events.dir, inventory);
    ctx.events.append({
      phase: "recon",
      actor: "runner",
      action: inventory.target.hostnameMatch ? "local_inventory_collected" : "local_inventory_failed",
      result: inventory.target.hostnameMatch
        ? `host-inventory.json written for ${hostname} (collected on-host via the paired pc-agent channel).`
        : `host-inventory.json written for ${hostname} in the failed form: the collected hostname did not match the declared local target.`,
    });
  } catch (err) {
    const error = `local inventory collection failed: ${(err as Error).message}`;
    await writeFailedInventoryArtifact(ctx.events.dir, hostname, error).catch(() => undefined);
    ctx.events.append({ phase: "recon", actor: "runner", action: "local_inventory_failed", result: error });
  }
  return true;
}

export async function reconPhase(ctx: Ctx): Promise<string> {
  if (ctx.config.dryRunAgents) {
    ctx.events.append({ phase: "recon", actor: "recon", action: "recon_brief", result: "dry-run: recon skipped." });
    return "dry-run brief";
  }
  // Q-RP-11: a local engagement's inventory is collected mechanically
  // at the head of recon (never in dry-run: collection touches the
  // bridge and can raise consent prompts).
  await collectLocalHostInventory(ctx);
  const brief = await agentLoop(
    ctx,
    "recon",
    "recon",
    reconPrompt(promptCtx(ctx)),
    `Begin reconnaissance of ${ctx.input.target}. In-scope hosts: ${ctx.hosts.join(", ")}. ` +
      (ctx.input.mode === "red"
        ? "Use secscan_exec with depth=deep for the active tier."
        : "Start with the passive tier (secscan_exec at depth=passive). Escalate only if the plan calls for it.") +
      // The shared target map is the handoff the coordinator actually reviews.
      // Asking only for a brief let an agent spend every turn on scanners, write
      // nothing to the map, and loop until the run died — the work was real but
      // invisible to the rest of the team.
      ` Write each discovery to the shared target map with update_target_map as you make it — ` +
      `the map is what the coordinator reviews at sign-off, and it is refused while the map is empty. ` +
      `Finish with the attack-surface brief and end it with the FINGERPRINT: line.`,
    // Q-BRIDGE-TOOLS: bridge tools join the surface when the bridge
    // is live on this machine (bridge-gate.ts).
    await withBridgeTools(ctx, "recon", RECON_TOOLS),
    ctx.config.maxReconTurns,
  );
  ctx.events.append({ phase: "recon", actor: "recon", action: "recon_brief", result: brief.slice(0, 1200) });
  // Target fingerprint: the runner parses the FINGERPRINT: line from the brief
  // (format: FINGERPRINT: stack=<csv>; appType=<...>; notes=<one line>).
  const fp = brief.match(/FINGERPRINT:\s*stack=([^;]*);\s*appType=([^;]*);\s*notes=([^\n]*)/i);
  if (fp) {
    const stack = fp[1]!.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    const appType = fp[2]!.trim() || "unknown";
    ctx.fingerprint = { host: ctx.domain, stack, appType, notes: fp[3]!.trim().slice(0, 200) || undefined };
    ctx.events.append({ phase: "recon", actor: "runner", action: "fingerprint", result: JSON.stringify(ctx.fingerprint) });
  }
  return brief;
}

// ---------------------------------------------------------------------------
// Dynamic orchestration: decompose → delegate → observe → re-plan.
//
// The coordinator never runs a long static plan. It breaks the operation into
// small discrete tasks; the runner validates each task against the cyber
// constraints (ROE, ATT&CK catalog, battery) and executes it by feeding it to
// the foundation (a bounded completeForRole loop = one specialist subagent).
// After every observation round the coordinator re-evaluates: pivot,
// escalate, go stealthy, back off, or spawn more help.
// ---------------------------------------------------------------------------

/** A discrete unit of work: one task, one specialist, one objective. */
