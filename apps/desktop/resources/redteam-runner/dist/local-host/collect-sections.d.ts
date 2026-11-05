/**
 * Section assembly for local host mode — the raw-section parsers, the
 * unsupported/failed/uncollected section builders, and the tier-2 block
 * runner. Split out of collect.ts for the file budget; the parsing and
 * failure semantics are unchanged.
 *
 * Every name here is exported for collect.ts only: collect.ts does not
 * re-export them, so the module surface of local-host/index.js is the same
 * as it was before the split.
 */
import { type LocalChannel } from "./collect-bridge.js";
import type { LocalHostInventory, LocalInventorySection, LocalSystemInfo } from "./types.js";
/** Hostname comparison: case-insensitive, and a short name matches its own FQDN. */
export declare function hostnameMatches(declared: string, collected: string): boolean;
/** Parse a bridge result as JSON when it is JSON; undefined otherwise. */
export declare function parseJson(text: string): Record<string, unknown> | undefined;
/** Map a system_info result onto the fields the collector relies on. */
export declare function toSystemInfo(text: string): LocalSystemInfo;
/** Cap one raw bridge result at LOCAL_RAW_CAP, flagging truncation. */
export declare function capRaw(text: string): {
    raw: string;
    truncated: boolean;
};
export declare function errorText(error: unknown): string;
export declare function failedSection<T>(note: string): LocalInventorySection<T>;
export declare function unsupportedSections(): Pick<LocalHostInventory["sections"], "services" | "listeningPorts">;
/** The four tier-2 blocks as section keys. */
export type Tier2Sections = Pick<LocalHostInventory["sections"], "volumes" | "users" | "installedSoftware" | "patches">;
/** The tier-2 blocks when collection never reached them (identity gate). */
export declare function unCollectedSections(note: string): Tier2Sections;
/**
 * Collect the four tier-2 enumeration blocks, sequentially — on a real
 * bridge each `shell_pwsh` call can raise a consent prompt, and prompts
 * must arrive one at a time, never stacked.
 * @param channel - the collector channel.
 * @returns the four sections, keyed as the inventory record names them.
 */
export declare function collectTier2Sections(channel: LocalChannel): Promise<Tier2Sections>;
