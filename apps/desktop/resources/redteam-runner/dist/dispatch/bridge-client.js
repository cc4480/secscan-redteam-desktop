/** A classified bridge failure; `kind` is what callers branch on. */
export class BridgeCallError extends Error {
    kind;
    constructor(kind, message) {
        super(message);
        this.name = "BridgeCallError";
        this.kind = kind;
    }
}
/** The client every seam falls back to: the bridge is simply not there. */
export const UNAVAILABLE_BRIDGE_CLIENT = {
    async available() {
        return false;
    },
    async listTools() {
        throw new BridgeCallError("unavailable", "no bridge client is available on this machine");
    },
    async call(name) {
        throw new BridgeCallError("unavailable", `bridge tool ${name} cannot run: no bridge client is available on this machine`);
    },
};
function asRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value
        : undefined;
}
/** Flatten any client result shape to the text the fleet consumes. */
function resultText(result) {
    if (typeof result === "string")
        return result;
    const record = asRecord(result);
    if (record) {
        // A's BridgeCallResult already carries the joined text.
        if (typeof record.text === "string")
            return record.text;
        if (Array.isArray(record.content)) {
            const parts = [];
            for (const item of record.content) {
                const part = asRecord(item);
                if (part && part.type === "text" && typeof part.text === "string")
                    parts.push(part.text);
            }
            if (parts.length > 0)
                return parts.join("\n");
        }
    }
    return JSON.stringify(result) ?? String(result);
}
/**
 * Classify a thrown client error. A's BridgeError carries a `code`
 * ("unavailable" | "bridge-error" | "bridge-denied"); anything else's
 * kind/code/name/message is matched best-effort so an honestly-worded
 * failure still lands in the right bucket.
 */
function errorKind(error) {
    const record = asRecord(error);
    const code = typeof record?.code === "string" ? record.code
        : typeof record?.kind === "string" ? record.kind
            : "";
    const name = error instanceof Error ? error.name : "";
    const message = error instanceof Error ? error.message : String(error);
    const haystack = `${code} ${name} ${message}`;
    if (/bridge-denied|denied by local approval|local approval.*(denied|timed out)/i.test(haystack))
        return "bridge-denied";
    if (/unavailable|not configured|unreachable|ECONNREFUSED|fetch failed|timed? ?out/i.test(haystack))
        return "unavailable";
    return "bridge-error";
}
function toBridgeCallError(error) {
    if (error instanceof BridgeCallError)
        return error;
    const message = error instanceof Error ? error.message : String(error);
    return new BridgeCallError(errorKind(error), message);
}
/**
 * Normalize a raw client (A's, or a test's raw fake) into the shape B
 * consumes: results flattened to text, failures classified into
 * {@link BridgeErrorKind}. No filtering — the full registry passes
 * through (Carlos's order, 2026-10-31).
 */
export function wrapBridgeClient(raw) {
    return {
        async available() {
            try {
                return await raw.available();
            }
            catch {
                return false;
            }
        },
        async listTools() {
            try {
                return [...(await raw.listTools())];
            }
            catch (error) {
                throw toBridgeCallError(error);
            }
        },
        async call(name, args) {
            try {
                return resultText(await raw.call(name, args));
            }
            catch (error) {
                throw toBridgeCallError(error);
            }
        },
    };
}
async function loadDefaultBridgeClient() {
    try {
        // Variable specifier on purpose: src/bridge is Builder A's module and
        // may not exist in a given tree state; a static import would fail this
        // module's compilation and tests whenever it is absent. A's barrel
        // (src/bridge/index.ts) is the confirmed entry point.
        const specifier = "../bridge/index.js";
        const mod = (await import(specifier));
        if (typeof mod.createBridgeClient !== "function")
            return UNAVAILABLE_BRIDGE_CLIENT;
        // A resolves its own configuration (bridge URL + paired token file)
        // from the environment; B passes nothing.
        return wrapBridgeClient(mod.createBridgeClient());
    }
    catch {
        return UNAVAILABLE_BRIDGE_CLIENT;
    }
}
let defaultClient;
/**
 * Resolve the bridge client for an engagement: the injected test seam
 * when present, otherwise the lazily-built default (A's client behind
 * the normalizing wrapper, or the always-unavailable fallback).
 */
export async function resolveBridgeClient(ctx) {
    if (ctx.deps.bridgeClient)
        return ctx.deps.bridgeClient;
    const pending = (defaultClient ??= loadDefaultBridgeClient());
    return pending;
}
//# sourceMappingURL=bridge-client.js.map