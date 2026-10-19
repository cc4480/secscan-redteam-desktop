import { PC_AGENT_TOOL_NAMES, PC_ACT_OPERATIONS, PC_OBSERVE_OPERATIONS, PC_RUN_OPERATIONS, } from "../tools/pc-agent.js";
import { createPcAgentClient, parsePcAgentReceipt, pcAgentConfig, pcAgentToolTier, } from "../host-exec/pc-agent.js";
/** Environment flag the operator sets to allow tier-2 actions for a session. */
export const PC_AGENT_DESTRUCTIVE_ENV = "REDTEAM_PC_AGENT_ALLOW_DESTRUCTIVE";
/** Arguments the bridge receives: everything except the orchestration fields. */
function bridgeArgs(args) {
    const { operation, ...rest } = args;
    void operation;
    return rest;
}
/**
 * Handle one local-PC tool call.
 * @param ctx - engagement context (unused today; kept for the handler contract).
 * @param _role - actor role (unused).
 * @param _phase - engagement phase (unused).
 * @param call - the model's tool call.
 * @param args - parsed arguments.
 * @param fetchImpl - transport seam for tests; defaults to global fetch.
 * @returns the dispatch result, or null when the tool is not ours.
 */
export async function handlePcAgentTools(ctx, _role, _phase, call, args, fetchImpl) {
    void ctx;
    if (!PC_AGENT_TOOL_NAMES.has(call.name))
        return null;
    const config = pcAgentConfig();
    if (config === undefined) {
        return { result: "DENIED: pc-agent is not configured (REDTEAM_PC_AGENT_URL / REDTEAM_PC_AGENT_TOKEN)", ok: false };
    }
    const operation = typeof args["operation"] === "string" ? args["operation"] : "";
    const allowed = call.name === "pc_observe"
        ? PC_OBSERVE_OPERATIONS.includes(operation)
        : call.name === "pc_act"
            ? PC_ACT_OPERATIONS.includes(operation)
            : PC_RUN_OPERATIONS.includes(operation);
    if (!allowed)
        return { result: `DENIED: operation ${JSON.stringify(operation)} does not belong to ${call.name}`, ok: false };
    // The tier is the bridge's own classification, checked here as well: a name
    // that drifted into the wrong family cannot slip a tier-2 call into pc_act.
    const tier = pcAgentToolTier(operation);
    const expectedTier = call.name === "pc_observe" ? 0 : call.name === "pc_act" ? 1 : 2;
    if (tier !== expectedTier) {
        return { result: `DENIED: ${operation} is tier ${String(tier)}, not ${String(expectedTier)}`, ok: false };
    }
    if (tier === 2 && (process.env[PC_AGENT_DESTRUCTIVE_ENV] ?? "").trim() !== "1") {
        return {
            result: `DENIED: ${operation} is destructive; the operator must enable it for this session (${PC_AGENT_DESTRUCTIVE_ENV}=1)`,
            ok: false,
        };
    }
    const transport = fetchImpl ?? globalThis.fetch;
    const client = createPcAgentClient(config, transport);
    try {
        const result = await client.callWithReceipt(operation, bridgeArgs(args));
        const receipt = result.receipt ?? parsePcAgentReceipt(result.text);
        if (receipt?.ok === false || receipt?.changed === false) {
            const code = receipt.error?.code ?? "UNCHANGED";
            return { result: `pc-agent action failed (${code}): ${result.text.slice(0, 1500)}`, ok: false };
        }
        if (receipt?.assert?.pass === false) {
            return { result: `pc-agent postcondition failed: ${result.text.slice(0, 1500)}`, ok: false };
        }
        return { result: result.text, ok: true };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { result: `pc-agent error: ${message}`, ok: false };
    }
}
//# sourceMappingURL=pc-agent.js.map