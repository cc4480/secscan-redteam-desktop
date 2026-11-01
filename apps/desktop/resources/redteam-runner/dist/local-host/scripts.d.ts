/**
 * Local host mode — tier-2 collection: four fixed read-only PowerShell
 * scripts, run through the paired bridge's `shell_pwsh` op.
 *
 * Why this tier exists (pair-log conflict flag + coordinator ruling,
 * 2026-10-31): the artifact contract requires volumes / accounts /
 * patches / software blocks, but the bridge's read-class ops enumerate
 * none of them — tier-0 alone can only emit those blocks empty. The
 * audit's objection to the old `/pcscan` was network services
 * (SMB/WinRM/SSH) and test credentials ON THE TARGET; local execution
 * through the operator's own paired agent needs neither, so the ruling
 * fills the four blocks for real through the channel that already exists.
 *
 * Binding properties:
 * - The scripts are FIXED STRINGS in this file. No model-supplied or
 *   engagement-supplied value is interpolated into them, ever — the
 *   collector sends `{ script, timeout_s }` and nothing else.
 * - Every cmdlet is read-only (Get-Volume, Get-LocalUser, Get-LocalGroup,
 *   Get-LocalGroupMember, Get-HotFix, Get-ItemProperty on the standard
 *   uninstall keys). Nothing in any script mutates the machine.
 * - The bridge's consent behavior is untouched: `shell_pwsh` raises
 *   whatever approval dialog the bridge raises, and a decline or timeout
 *   fails that one block (see collect.ts) — collection continues and the
 *   artifact records the block as not collected.
 * - The bridge caps returned stdout at its last 4000 characters, so an
 *   over-long result arrives as unparseable JSON. Parsing here is strict
 *   for exactly that reason: a block whose output does not parse whole
 *   is reported not collected, never partially — a truncated software
 *   list presented as complete would be a fabricated inventory.
 */
import type { LocalAccountRow, LocalPatchRow, LocalSoftwareRow, LocalVolumeRow } from "./types.js";
/** The bridge tool the tier-2 pass runs through. */
export declare const LOCAL_TIER2_TOOL = "shell_pwsh";
/** One fixed collection script and its bridge timeout. */
export interface LocalTier2Block {
    /** The exact script text sent to the bridge; never interpolated. */
    readonly script: string;
    /** Bridge `timeout_s` for the call (bridge default 60, cap 300). */
    readonly timeoutS: number;
}
/**
 * The four tier-2 blocks, in collection order. `String.raw` keeps the
 * scripts byte-exact (registry paths carry single backslashes).
 */
export declare const LOCAL_TIER2_BLOCKS: {
    readonly volumes: {
        readonly script: string;
        readonly timeoutS: 60;
    };
    readonly accounts: {
        readonly script: string;
        readonly timeoutS: 240;
    };
    readonly patches: {
        readonly script: string;
        readonly timeoutS: 120;
    };
    readonly software: {
        readonly script: string;
        readonly timeoutS: 60;
    };
};
/** The tier-2 block names, in collection order. */
export type LocalTier2BlockName = keyof typeof LOCAL_TIER2_BLOCKS;
/**
 * Reduce a `shell_pwsh` result to the script's stdout.
 *
 * The bridge answers with a `{ returncode, stdout, stderr }` envelope
 * (or `{ timed_out: true, ... }`); the runner's client hands the
 * collector that envelope serialized as JSON text. A nonzero exit, a
 * timeout, or an error envelope throws — the caller records the block as
 * not collected. A result that is not the envelope (a stub channel's raw
 * script output) is returned unchanged.
 * @param text - the channel's result text for one `shell_pwsh` call.
 * @returns the script's stdout.
 */
export declare function shellStdout(text: string): string;
/**
 * Parse the volumes script's stdout.
 * @param stdout - the script's stdout (post {@link shellStdout}).
 * @returns the volume rows.
 */
export declare function parseVolumeRows(stdout: string): readonly LocalVolumeRow[];
/**
 * Parse the accounts script's stdout.
 * @param stdout - the script's stdout (post {@link shellStdout}).
 * @returns the account rows.
 */
export declare function parseAccountRows(stdout: string): readonly LocalAccountRow[];
/**
 * Parse the patches script's stdout.
 * @param stdout - the script's stdout (post {@link shellStdout}).
 * @returns the hotfix rows, most recent first (the script sorts).
 */
export declare function parsePatchRows(stdout: string): readonly LocalPatchRow[];
/**
 * Parse the software script's stdout. The same program can appear under
 * several uninstall keys (both hives, the WOW6432Node view); identical
 * name+version+publisher rows are one program and are counted once.
 * @param stdout - the script's stdout (post {@link shellStdout}).
 * @returns the software rows, de-duplicated.
 */
export declare function parseSoftwareRows(stdout: string): readonly LocalSoftwareRow[];
/**
 * The artifact's patch-level summary for a COLLECTED patch block.
 * @param rows - the collected hotfix rows, most recent first.
 * @returns the one-line summary.
 */
export declare function patchLevelSummary(rows: readonly LocalPatchRow[]): string;
