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
import { buildLocalEngagementInput, COMMANDS, commandHelp, parseCommand, planCommand } from "../workflows/commands.js";
import { runEngagement } from "../phases.js";
/** Read the quoted command line: `command "<line>"`. */
function commandLine() {
    return process.argv[3] ?? "";
}
/** Print the help table for `redteam-runner commands`. */
export function printCommandHelp() {
    console.log(commandHelp());
}
/**
 * Build the EngagementInput for a NON-local command invocation (S2-H2):
 * the command's tier and phase list ride into the input alongside the
 * resolved target families, so the engagement that runs is the one the
 * registry defines — /nmap at tier 0 over recon+report, /metasploit at
 * tier 2 — not the environment default tier over the full pipeline.
 * Before this builder existed the CLI assembled the input inline and
 * dropped both fields.
 * @param invocation - parsed command invocation.
 * @param target - the --target host/URL the operator named.
 * @param mode - engagement mode from the CLI (red|black).
 * @param roe - rules of engagement from the CLI scope flags.
 * @returns the engagement input for runEngagement.
 */
export function buildCommandEngagementInput(invocation, target, mode, roe) {
    return {
        target,
        mode,
        objective: `${invocation.command.summary} (${invocation.command.name})`,
        roe,
        targets: [...invocation.targets],
        tier: invocation.command.tier,
        phases: [...invocation.command.phases],
    };
}
/**
 * Run the `command` subcommand.
 * @returns exit code (0 ok, 2 usage, 3 bad invocation, 1 run failure).
 */
export async function runCommandCli() {
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
    if (flag("--json"))
        console.log(JSON.stringify(summary, null, 2));
    else {
        console.log(`COMMAND  ${parsed.command.name}  (tier ${parsed.command.tier}${parsed.command.requiresApproval ? ", approval required" : ""})`);
        console.log(`  ${parsed.command.summary}`);
        console.log(`  usage:   ${parsed.command.usage}`);
        console.log(`  targets: ${parsed.targets.join(", ") || "(none)"}`);
        console.log(`  artifacts: ${parsed.command.artifacts.join(", ")}`);
        console.log("  plan:");
        for (const phase of plan)
            console.log(`    ${phase.phase.padEnd(9)} ${phase.objective}`);
    }
    if (!flag("--execute")) {
        if (!flag("--json"))
            console.log("\n[dry plan] re-run with --execute to start the engagement");
        return 0;
    }
    if (parsed.command.requiresApproval && !flag("--approve")) {
        console.error(`[runner] ${parsed.command.name} requires operator approval; re-run with --approve`);
        return 3;
    }
    const mode = (arg("--mode") ?? "red");
    if (mode !== "red" && mode !== "black") {
        console.error(`[runner] --mode must be red|black (got ${mode})`);
        return 3;
    }
    // Q-RP-11: a local command (/pcscan) assesses THIS machine — its input
    // is built mechanically from the hostname with localHost set, and an
    // explicit --target/--scope cannot re-aim it at another host.
    if (parsed.command.local) {
        const result = await runEngagement(buildLocalEngagementInput(parsed, hostname(), mode));
        if (flag("--json"))
            console.log(JSON.stringify({ command: parsed.command.name, engagementId: result.engagementId, status: result.status, findings: result.findings.length, reportPath: result.reportPath }, null, 2));
        else {
            console.log(`\n[runner] ${parsed.command.name} ${result.status} — ${String(result.findings.length)} finding(s)`);
            if (result.reportPath !== undefined)
                console.log(`[runner] report: ${result.reportPath}`);
            if (result.blockedReason !== undefined)
                console.log(`[runner] blocked: ${result.blockedReason}`);
        }
        return result.status === "complete" || result.status === "halted" ? 0 : 1;
    }
    const target = arg("--target");
    if (target === undefined) {
        console.error(`[runner] ${parsed.command.name} needs --target <host|url>`);
        return 3;
    }
    const scopes = argAll("--scope");
    const outOfScope = argAll("--out-of-scope");
    const roe = {
        scope: scopes.length > 0 ? scopes : [target],
        ...(outOfScope.length > 0 ? { outOfScope } : {}),
    };
    // S2-H2: the input is built by the workflows builder so the command's
    // tier and phase list ride into the engagement (this inline literal
    // used to drop both, and every sibling ran the default tier's full
    // pipeline).
    const input = buildCommandEngagementInput(parsed, target, mode, roe);
    const result = await runEngagement(input);
    if (flag("--json"))
        console.log(JSON.stringify({ command: parsed.command.name, engagementId: result.engagementId, status: result.status, findings: result.findings.length, reportPath: result.reportPath }, null, 2));
    else {
        console.log(`\n[runner] ${parsed.command.name} ${result.status} — ${String(result.findings.length)} finding(s)`);
        if (result.reportPath !== undefined)
            console.log(`[runner] report: ${result.reportPath}`);
        if (result.blockedReason !== undefined)
            console.log(`[runner] blocked: ${result.blockedReason}`);
    }
    return result.status === "complete" || result.status === "halted" ? 0 : 1;
}
/** Every command name, for shell completion and docs. */
export function commandNames() {
    return COMMANDS.map(command => command.name);
}
//# sourceMappingURL=command.js.map