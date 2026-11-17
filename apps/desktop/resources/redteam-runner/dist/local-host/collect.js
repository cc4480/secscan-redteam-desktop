import { localVerificationProof } from "./collect-bridge.js";
import { capRaw, collectTier2Sections, errorText, failedSection, hostnameMatches, parseJson, toSystemInfo, unCollectedSections, unsupportedSections, } from "./collect-sections.js";
// The bridge seam and the local-mode builders live in collect-bridge.ts (a
// file-budget split). Re-exported here so every importer of this module —
// phases/recon.ts, local-host/index.ts, the tests — is unchanged.
export { LOCAL_INVENTORY_OPERATIONS, LOCAL_RAW_CAP, buildLocalEngagementInput, localChannelFromEnv, localVerificationProof, } from "./collect-bridge.js";
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