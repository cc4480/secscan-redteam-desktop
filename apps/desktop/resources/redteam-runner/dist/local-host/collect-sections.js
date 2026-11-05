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
import { LOCAL_RAW_CAP } from "./collect-bridge.js";
import { LOCAL_TIER2_BLOCKS, LOCAL_TIER2_TOOL, parseAccountRows, parsePatchRows, parseSoftwareRows, parseVolumeRows, shellStdout, } from "./scripts.js";
/**
 * Sections no collection tier answers in v1, with the reason each is
 * unsupported. Volumes, accounts, patches, and software moved off this
 * list when the tier-2 pass landed (scripts.ts); services and listening
 * ports stay here — no fixed read-only script for them is in v1's scope,
 * and an unmeasured section is named, never fabricated.
 */
const UNSUPPORTED_SECTIONS = [
    ["services", "no pc-agent op enumerates services"],
    ["listeningPorts", "no pc-agent op enumerates listening ports"],
];
/** Hostname comparison: case-insensitive, and a short name matches its own FQDN. */
export function hostnameMatches(declared, collected) {
    const a = declared.trim().toLowerCase();
    const b = collected.trim().toLowerCase();
    if (a === "" || b === "")
        return false;
    return a === b || a === b.split(".")[0] || b === a.split(".")[0];
}
/** Parse a bridge result as JSON when it is JSON; undefined otherwise. */
export function parseJson(text) {
    try {
        const parsed = JSON.parse(text);
        return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed
            : undefined;
    }
    catch {
        return undefined;
    }
}
function asString(value) {
    return typeof value === "string" && value !== "" ? value : undefined;
}
function asNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
/** Map a system_info result onto the fields the collector relies on. */
export function toSystemInfo(text) {
    const record = parseJson(text);
    if (record === undefined)
        return {};
    return {
        ...(asString(record["system"]) !== undefined ? { system: asString(record["system"]) } : {}),
        ...(asString(record["release"]) !== undefined ? { release: asString(record["release"]) } : {}),
        ...(asString(record["version"]) !== undefined ? { version: asString(record["version"]) } : {}),
        ...(asString(record["machine"]) !== undefined ? { machine: asString(record["machine"]) } : {}),
        ...(asString(record["hostname"]) !== undefined ? { hostname: asString(record["hostname"]) } : {}),
        ...(asString(record["user"]) !== undefined ? { user: asString(record["user"]) } : {}),
        ...(asNumber(record["cpu_percent"]) !== undefined ? { cpuPercent: asNumber(record["cpu_percent"]) } : {}),
        ...(asNumber(record["mem_percent"]) !== undefined ? { memPercent: asNumber(record["mem_percent"]) } : {}),
    };
}
/** Cap one raw bridge result at LOCAL_RAW_CAP, flagging truncation. */
export function capRaw(text) {
    return text.length > LOCAL_RAW_CAP
        ? { raw: text.slice(0, LOCAL_RAW_CAP), truncated: true }
        : { raw: text, truncated: false };
}
export function errorText(error) {
    return error instanceof Error ? error.message : String(error);
}
export function failedSection(note) {
    return { status: "failed", note, batteryCoverage: "none" };
}
export function unsupportedSections() {
    const sections = {};
    for (const [name, reason] of UNSUPPORTED_SECTIONS) {
        sections[name] = { status: "unsupported", note: reason, batteryCoverage: "none" };
    }
    return sections;
}
/** The tier-2 blocks when collection never reached them (identity gate). */
export function unCollectedSections(note) {
    return {
        volumes: failedSection(note),
        users: failedSection(note),
        installedSoftware: failedSection(note),
        patches: failedSection(note),
    };
}
/**
 * Run one tier-2 block: its fixed script through the bridge's shell path.
 * A declined consent prompt, a bridge timeout, a nonzero exit, or output
 * that does not parse whole all land here as one failed section whose
 * note says the block was not collected — the other blocks are unaffected.
 * @param channel - the collector channel.
 * @param block - the fixed script and timeout for this block.
 * @param parse - the block's stdout parser.
 * @returns the collected or honestly-failed section.
 */
async function tier2Section(channel, block, parse) {
    try {
        const text = await channel.call(LOCAL_TIER2_TOOL, {
            script: block.script,
            timeout_s: block.timeoutS,
        });
        return { status: "collected", data: parse(shellStdout(text)), batteryCoverage: "partial" };
    }
    catch (error) {
        return { status: "failed", note: `not collected: ${errorText(error)}`, batteryCoverage: "none" };
    }
}
/**
 * Collect the four tier-2 enumeration blocks, sequentially — on a real
 * bridge each `shell_pwsh` call can raise a consent prompt, and prompts
 * must arrive one at a time, never stacked.
 * @param channel - the collector channel.
 * @returns the four sections, keyed as the inventory record names them.
 */
export async function collectTier2Sections(channel) {
    const volumes = await tier2Section(channel, LOCAL_TIER2_BLOCKS.volumes, parseVolumeRows);
    const users = await tier2Section(channel, LOCAL_TIER2_BLOCKS.accounts, parseAccountRows);
    const patches = await tier2Section(channel, LOCAL_TIER2_BLOCKS.patches, parsePatchRows);
    const installedSoftware = await tier2Section(channel, LOCAL_TIER2_BLOCKS.software, parseSoftwareRows);
    return { volumes, users, installedSoftware, patches };
}
//# sourceMappingURL=collect-sections.js.map