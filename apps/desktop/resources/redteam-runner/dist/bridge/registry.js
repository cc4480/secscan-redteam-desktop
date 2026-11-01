/**
 * Probe a bridge client and record what it offers.
 * @param client - the client to probe.
 * @returns the snapshot; `available: false` with an empty tool list when the
 *   bridge cannot be reached or is not paired.
 */
export async function snapshotBridgeRegistry(client) {
    const probedAt = new Date().toISOString();
    if (!(await client.available())) {
        return { probedAt, endpoint: client.endpoint, available: false, tools: [], toolNames: [] };
    }
    const tools = [...(await client.listTools())].sort((a, b) => a.name.localeCompare(b.name));
    return {
        probedAt,
        endpoint: client.endpoint,
        available: true,
        tools,
        toolNames: tools.map((tool) => tool.name),
    };
}
//# sourceMappingURL=registry.js.map