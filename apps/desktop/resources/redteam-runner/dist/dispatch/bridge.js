import { BridgeCallError, resolveBridgeClient } from "./bridge-client.js";
import { bridgeOpName, isBridgeToolName } from "./bridge-gate.js";
/**
 * Handle one bridge tool call.
 * @param ctx - the engagement context.
 * @param _role - actor role (unused; the gate is engagement-scoped).
 * @param _phase - engagement phase (unused).
 * @param call - the model's tool call.
 * @param args - parsed arguments, forwarded to the bridge unchanged.
 * @param clientArg - client seam for tests; defaults to the resolved client.
 * @returns the dispatch result, or null when the tool is not ours.
 */
export async function handleBridgeTools(ctx, _role, _phase, call, args, clientArg) {
    if (!isBridgeToolName(call.name))
        return null;
    const op = bridgeOpName(call.name);
    const client = clientArg ?? (await resolveBridgeClient(ctx));
    // The gate: the bridge must answer NOW, not merely when the tool
    // list was composed.
    let available = false;
    try {
        available = await client.available();
    }
    catch {
        available = false;
    }
    if (!available) {
        return {
            result: `DENIED: the AlterEgo bridge is not available on this machine right now, so ${call.name} ` +
                "cannot run. The engagement continues without bridge tools.",
            ok: false,
        };
    }
    try {
        const text = await client.call(op, args);
        return { result: text, ok: true };
    }
    catch (err) {
        if (err instanceof BridgeCallError) {
            if (err.kind === "bridge-denied") {
                return {
                    result: `DENIED: the bridge's operator consent denied ${call.name} (${err.message}). The operator said no; do not retry it.`,
                    ok: false,
                };
            }
            if (err.kind === "unavailable") {
                return {
                    result: `DENIED: the AlterEgo bridge became unavailable before ${call.name} could run (${err.message}).`,
                    ok: false,
                };
            }
            return { result: `bridge error: ${err.message}`, ok: false };
        }
        const message = err instanceof Error ? err.message : String(err);
        return { result: `bridge error: ${message}`, ok: false };
    }
}
//# sourceMappingURL=bridge.js.map