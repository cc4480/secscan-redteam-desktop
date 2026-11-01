/** Tools whose arguments commonly name a network target (Python NETWORK_TOOLS). */
export declare const NETWORK_TOOLS: ReadonlySet<string>;
export declare const SUBSTITUTION_RE: RegExp;
/**
 * TLDs that are never file extensions (Python `_NEVER_A_FILE_EXT_TLDS`),
 * including internal AD suffixes. A bare dotted token ending in one of
 * these counts as a hostname even without a network tool in the command;
 * any other bare dotted token (report.json) counts only in network-tool
 * context, so ordinary file arguments are not mistaken for hosts.
 */
export declare const NEVER_FILE_EXT_TLDS: ReadonlySet<string>;
/**
 * The command with every shell-substitution span removed (Python
 * `_strip_substitutions`): the static skeleton known before the shell runs.
 *
 * @param command - The raw command text.
 * @returns The command with $(...), ${...}, $var and `...` spans blanked.
 */
export declare function stripSubstitutions(command: string): string;
/**
 * True if any segment of the command invokes a known network binary
 * (Python `command_uses_network_tool`): the command line is split on shell
 * separators, leading assignments and prefix words (sudo/env/timeout/…)
 * are stripped, and the binary's basename is compared to NETWORK_TOOLS.
 *
 * @param command - The raw command text.
 * @returns Whether a network tool is invoked anywhere in the command.
 */
export declare function commandUsesNetworkTool(command: string): boolean;
/**
 * Best-effort extraction of network targets from a shell command (Python
 * `extract_targets`). Unambiguous targets (URLs, host:port, IPs, CIDRs,
 * impacket and UNC forms) are always returned; bare dotted hostnames only
 * in network-tool context or with a never-a-file-extension TLD.
 *
 * @param command - The raw command text.
 * @param networkContext - Whether the command runs a known network tool;
 *   computed from the command when omitted.
 * @returns The extracted target hosts, in order of appearance.
 */
export declare function extractTargets(command: string, networkContext?: boolean): string[];
