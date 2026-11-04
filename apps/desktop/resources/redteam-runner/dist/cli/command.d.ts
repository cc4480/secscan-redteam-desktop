import { type CommandInvocation } from "../workflows/commands.js";
import type { EngagementInput, RulesOfEngagement } from "../types.js";
/** Print the help table for `redteam-runner commands`. */
export declare function printCommandHelp(): void;
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
export declare function buildCommandEngagementInput(invocation: CommandInvocation, target: string, mode: EngagementInput["mode"], roe: RulesOfEngagement): EngagementInput;
/**
 * Run the `command` subcommand.
 * @returns exit code (0 ok, 2 usage, 3 bad invocation, 1 run failure).
 */
export declare function runCommandCli(): Promise<number>;
/** Every command name, for shell completion and docs. */
export declare function commandNames(): readonly string[];
