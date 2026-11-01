/**
 * Local host mode — the collector core.
 *
 * Why this exists: the audit (report-parity row 23) found the rebuild had no
 * local mode at all — `/pcscan` re-aimed the REMOTE Windows battery at
 * `os.hostname()`, whose checks need SMB/WinRM/SSH and test credentials on
 * the target, the exact combination a real field run stalled on
 * (host-exec/pc-agent.ts field note). Local mode inverts that: the target is
 * the machine this runner runs on, and collection happens over the
 * operator-paired pc-agent channel already running on that machine. No
 * network service and no target credential is involved. Collection runs
 * in two tiers over that one channel: tier-0 read-only bridge tools
 * (identity, processes, directory listings), then — only after the
 * identity gate passes — tier-2 fixed read-only PowerShell scripts
 * (scripts.ts) for the blocks no tier-0 op enumerates. The tier-2 scripts
 * are fixed strings, executed by the operator's own paired agent under
 * the bridge's own consent prompts; a declined prompt fails that one
 * block, honestly, and collection continues.
 *
 * Scope posture — explicit, never a silent bypass: a local engagement's
 * scope is exactly the machine's own hostname, and ownership is established
 * by possession: the operator paired the bridge on that machine (the 6-digit
 * pairing flow is a physical-presence act) and attests on the engagement
 * record. The collector enforces the claim mechanically — the collected
 * `system_info` hostname must match the declared local target, or
 * collection aborts before any further inventory is taken. No DNS or
 * service ownership verification applies to a machine assessing itself,
 * and none is claimed in the recorded proof.
 */
import { createPcAgentClient, pcAgentConfig, } from "../host-exec/pc-agent.js";
import { LOCAL_TIER2_BLOCKS, LOCAL_TIER2_TOOL, parseAccountRows, parsePatchRows, parseSoftwareRows, parseVolumeRows, shellStdout, } from "./scripts.js";
/** Raw section text cap; longer bridge results are truncated and flagged. */
export const LOCAL_RAW_CAP = 20_000;
/** Tier-0 inventory operations — the collector's first pass, all read-only. */
export const LOCAL_INVENTORY_OPERATIONS = [
    "system_info",
    "list_processes",
    "list_dir",
];
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
/**
 * The verification proof text recorded for a local engagement.
 * @param declaredHostname - the engagement's declared local target.
 * @param operatorName - the accountable operator, when named on the record.
 * @returns the basis text: possession of the paired channel plus attestation.
 */
export function localVerificationProof(declaredHostname, operatorName) {
    const operator = operatorName ?? "the engagement operator";
    return (`Local-mode ownership (operator possession): ${operator} runs this runner on ${declaredHostname} ` +
        `and paired the pc-agent bridge on that same machine; possession of the paired channel is the ` +
        `ownership evidence, and the operator attests on the engagement record that the machine is theirs ` +
        `to assess. The collected system_info hostname must match the declared local target before any ` +
        `inventory is accepted. No DNS/service ownership verification applies to a machine assessing ` +
        `itself, and none is claimed.`);
}
/**
 * Build the engagement input for a local-mode engagement.
 * @param opts - the local target hostname and the accountable operator.
 * @returns an engagement input whose scope is exactly the local hostname.
 */
export function buildLocalEngagementInput(opts) {
    return {
        target: opts.hostname,
        localHost: true,
        mode: opts.mode ?? "red",
        objective: opts.objective ?? "Assess this workstation (local host mode): inventory first, then the host battery.",
        roe: {
            scope: [opts.hostname],
            notes: "LOCAL MODE: the target is the machine this runner runs on. Collection is through the " +
                "paired pc-agent channel only (tier-0 reads, then fixed read-only tier-2 scripts); no " +
                "network services (SMB/WinRM/SSH) and no target credentials are used. Verification " +
                "basis: local-operator-possession — see the engagement record's verification proof.",
        },
        ...(opts.operatorName !== undefined ? { operatorName: opts.operatorName } : {}),
        targets: ["windows"],
    };
}
/**
 * Create a collector channel from the environment.
 * @param env - environment to read the bridge configuration from.
 * @param fetchImpl - transport seam for tests; defaults to global fetch.
 * @returns the channel, or undefined when the bridge is not configured —
 * the caller must fail loud, never fall back to network collection.
 */
export function localChannelFromEnv(env = process.env, fetchImpl) {
    const config = pcAgentConfig(env);
    if (config === undefined)
        return undefined;
    const transport = fetchImpl ?? globalThis.fetch;
    return createPcAgentClient(config, transport);
}
/** Hostname comparison: case-insensitive, and a short name matches its own FQDN. */
function hostnameMatches(declared, collected) {
    const a = declared.trim().toLowerCase();
    const b = collected.trim().toLowerCase();
    if (a === "" || b === "")
        return false;
    return a === b || a === b.split(".")[0] || b === a.split(".")[0];
}
/** Parse a bridge result as JSON when it is JSON; undefined otherwise. */
function parseJson(text) {
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
function toSystemInfo(text) {
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
function capRaw(text) {
    return text.length > LOCAL_RAW_CAP
        ? { raw: text.slice(0, LOCAL_RAW_CAP), truncated: true }
        : { raw: text, truncated: false };
}
function errorText(error) {
    return error instanceof Error ? error.message : String(error);
}
function failedSection(note) {
    return { status: "failed", note, batteryCoverage: "none" };
}
function unsupportedSections() {
    const sections = {};
    for (const [name, reason] of UNSUPPORTED_SECTIONS) {
        sections[name] = { status: "unsupported", note: reason, batteryCoverage: "none" };
    }
    return sections;
}
/** The tier-2 blocks when collection never reached them (identity gate). */
function unCollectedSections(note) {
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
async function collectTier2Sections(channel) {
    const volumes = await tier2Section(channel, LOCAL_TIER2_BLOCKS.volumes, parseVolumeRows);
    const users = await tier2Section(channel, LOCAL_TIER2_BLOCKS.accounts, parseAccountRows);
    const patches = await tier2Section(channel, LOCAL_TIER2_BLOCKS.patches, parsePatchRows);
    const installedSoftware = await tier2Section(channel, LOCAL_TIER2_BLOCKS.software, parseSoftwareRows);
    return { volumes, users, installedSoftware, patches };
}
/**
 * Collect a local inventory through the paired channel.
 *
 * Order matters: `system_info` runs first and gates everything else — when
 * the machine's own hostname does not match the declared local target (or
 * identity cannot be read at all), collection aborts before any tier-2
 * call and every remaining section is marked failed with the reason.
 * Section failures after the identity gate are per-section, across both
 * tiers: one dead op or declined script does not lose the rest.
 * @param channel - the collector channel (the pc-agent client, or a stub).
 * @param opts - the declared target and collection options.
 * @returns the collected inventory record.
 */
export async function collectLocalInventory(channel, opts) {
    const collectedAt = (opts.now ?? (() => new Date()))().toISOString();
    const base = {
        version: 1,
        mode: "local",
        collectedAt,
        channel: { kind: "pc-agent", url: opts.channelUrl },
        verification: {
            basis: "local-operator-possession",
            proof: localVerificationProof(opts.declaredHostname, opts.operatorName),
            scopeHosts: [opts.declaredHostname],
        },
    };
    let systemText;
    try {
        systemText = await channel.call("system_info", {});
    }
    catch (error) {
        const note = `identity not established: system_info failed (${errorText(error)}); collection aborted`;
        return {
            ...base,
            target: { declaredHostname: opts.declaredHostname, collectedHostname: null, hostnameMatch: false },
            sections: {
                system: failedSection(note),
                processes: failedSection(note),
                filesystem: failedSection(note),
                ...unCollectedSections(note),
                ...unsupportedSections(),
            },
        };
    }
    const systemInfo = toSystemInfo(systemText);
    const collectedHostname = systemInfo.hostname ?? null;
    const cappedSystem = capRaw(systemText);
    const systemSection = {
        status: "collected",
        data: systemInfo,
        ...cappedSystem,
        ...(cappedSystem.truncated ? { truncated: true } : {}),
        batteryCoverage: "partial",
    };
    if (collectedHostname === null || !hostnameMatches(opts.declaredHostname, collectedHostname)) {
        const note = collectedHostname === null
            ? "collection aborted: system_info reported no hostname, so the local target cannot be confirmed"
            : `collection aborted: collected hostname ${JSON.stringify(collectedHostname)} does not match the declared local target ${JSON.stringify(opts.declaredHostname)}`;
        return {
            ...base,
            target: { declaredHostname: opts.declaredHostname, collectedHostname, hostnameMatch: false },
            sections: {
                system: { ...systemSection, note },
                processes: failedSection(note),
                filesystem: failedSection(note),
                ...unCollectedSections(note),
                ...unsupportedSections(),
            },
        };
    }
    let processes;
    try {
        const text = await channel.call("list_processes", {});
        const capped = capRaw(text);
        const parsed = parseJson(text);
        processes = {
            status: "collected",
            ...(parsed !== undefined ? { data: parsed } : {}),
            ...capped,
            ...(capped.truncated ? { truncated: true } : {}),
            batteryCoverage: "partial",
        };
    }
    catch (error) {
        processes = failedSection(`list_processes failed: ${errorText(error)}`);
    }
    const listings = [];
    const failures = [];
    for (const path of opts.dirPaths ?? ["."]) {
        try {
            const text = await channel.call("list_dir", { path });
            listings.push({ path, raw: capRaw(text).raw });
        }
        catch (error) {
            failures.push(`${path}: ${errorText(error)}`);
        }
    }
    const filesystem = listings.length > 0
        ? {
            status: "collected",
            data: listings,
            ...(failures.length > 0 ? { note: `failed listings: ${failures.join("; ")}` } : {}),
            batteryCoverage: "partial",
        }
        : failedSection(`all directory listings failed: ${failures.join("; ")}`);
    const tier2 = await collectTier2Sections(channel);
    return {
        ...base,
        target: { declaredHostname: opts.declaredHostname, collectedHostname, hostnameMatch: true },
        sections: {
            system: systemSection,
            processes,
            filesystem,
            ...tier2,
            ...unsupportedSections(),
        },
    };
}
//# sourceMappingURL=collect.js.map