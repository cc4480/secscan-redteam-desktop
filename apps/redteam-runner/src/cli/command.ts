/**
 * `redteam-runner command "<line>"` — the slash-command CLI.
 *
 * One operator line is parsed into the command spec, expanded into the ordered
 * phase plan, and (only with --execute) handed to the engagement engine. The
 * default is a dry plan: printing exactly what the run will do, and which
 * approval it needs, before anything touches a target.
 *
 *   redteam-runner commands                        # list commands
 *   redteam-runner command "/pcscan full"          # plan only
 *   redteam-runner command "/pcscan full" --execute
 *   redteam-runner command "/deepscan app.example.com webapp" --execute --approve
 */
import { hostname } from "node:os";
import { flag, arg, argAll } from "./args.js";
import { COMMANDS, commandHelp, parseCommand, planCommand } from "../workflows/commands.js";
import { runEngagement } from "../phases.js";
import type { EngagementInput, EngagementMode, RulesOfEngagement } from "../types.js";

/** Read the quoted command line: `command "<line>"`. */
function commandLine(): string {
  return process.argv[3] ?? "";
}

/** Print the help table for `redteam-runner commands`. */
export function printCommandHelp(): void {
  console.log(commandHelp());
}

/**
 * Run the `command` subcommand.
 * @returns exit code (0 ok, 2 usage, 3 bad invocation, 1 run failure).
 */
export async function runCommandCli(): Promise<number> {
  const line = commandLine();
  if (line.trim() === "") {
    console.error('Usage: redteam-runner command "<line>" [--execute] [--approve] [--json]');
    console.error("");
    printCommandHelp();
    return 2;
  }
  const parsed = parseCommand(line);
  if (typeof parsed === "string") {
    console.error(`[runner] ${parsed}`);
    return 3;
  }
  const plan = planCommand(parsed);
  const summary = {
    command: parsed.command.name,
    summary: parsed.command.summary,
    usage: parsed.command.usage,
    targets: parsed.targets,
    tier: parsed.command.tier,
    requiresApproval: parsed.command.requiresApproval,
    artifacts: parsed.command.artifacts,
    tools: parsed.command.tools,
    plan,
  };

  if (flag("--json")) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(`COMMAND  ${parsed.command.name}  (tier ${parsed.command.tier}${parsed.command.requiresApproval ? ", approval required" : ""})`);
    console.log(`  ${parsed.command.summary}`);
    console.log(`  usage:   ${parsed.command.usage}`);
    console.log(`  targets: ${parsed.targets.join(", ") || "(none)"}`);
    console.log(`  artifacts: ${parsed.command.artifacts.join(", ")}`);
    console.log("  plan:");
    for (const phase of plan) console.log(`    ${phase.phase.padEnd(9)} ${phase.objective}`);
  }

  if (!flag("--execute")) {
    if (!flag("--json")) console.log("\n[dry plan] re-run with --execute to start the engagement");
    return 0
  }

  if (parsed.command.requiresApproval && !flag("--approve")) {
    console.error(`[runner] ${parsed.command.name} requires operator approval; re-run with --approve`);
    return 3
  }

  const isPc = parsed.command.name === "/pcscan"
  const target = arg("--target") ?? (isPc ? hostname() : undefined)
  if (target === undefined) {
    console.error(`[runner] ${parsed.command.name} needs --target <host|url>`)
    return 3
  }
  const scopes = argAll("--scope")
  const mode = (arg("--mode") ?? "red") as EngagementMode
  if (mode !== "red" && mode !== "black") {
    console.error(`[runner] --mode must be red|black (got ${mode})`)
    return 3
  }
  const roe: RulesOfEngagement = { scope: scopes.length > 0 ? scopes : [target] }
  const input: EngagementInput = {
    target,
    mode,
    objective: `${parsed.command.summary} (${parsed.command.name})`,
    roe,
    targets: [...parsed.targets],
    ...isPc ? { environment: "production" as const, confirmProduction: true } : {},
  }
  const result = await runEngagement(input)
  if (flag("--json")) console.log(JSON.stringify({ command: parsed.command.name, engagementId: result.engagementId, status: result.status, findings: result.findings.length, reportPath: result.reportPath }, null, 2))
  else {
    console.log(`\n[runner] ${parsed.command.name} ${result.status} — ${String(result.findings.length)} finding(s)`)
    if (result.reportPath !== undefined) console.log(`[runner] report: ${result.reportPath}`)
    if (result.blockedReason !== undefined) console.log(`[runner] blocked: ${result.blockedReason}`)
  }
  return result.status === "complete" || result.status === "halted" ? 0 : 1
}

/** Every command name, for shell completion and docs. */
export function commandNames(): readonly string[] {
  return COMMANDS.map(command => command.name)
}
