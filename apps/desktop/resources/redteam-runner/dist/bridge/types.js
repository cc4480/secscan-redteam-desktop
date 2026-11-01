/**
 * Bridge client contracts: configuration fields, tool definitions, call
 * results, the registry snapshot record, and the typed error the client
 * raises.
 *
 * Design note (Carlos's order, 2026-10-31 ~18:00 CDT): there is NO allowlist.
 * The client exposes everything the bridge offers and forwards any call; the
 * bridge's own native consent dialog is the gate for destructive ops, not a
 * client-side name filter.
 *
 * The three error codes are the honest states a caller must be able to tell
 * apart: `unavailable` (no paired bridge reachable — a normal state, not a
 * failure), `bridge-error` (the bridge was reached and answered with an
 * error, or rejected the token), and `bridge-denied` (the bridge's own
 * consent dialog denied the call or timed out — the operator said no, which
 * is neither a transport failure nor a success).
 */
/** Error raised by the bridge client; `code` names which honest state failed. */
export class BridgeError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "BridgeError";
        this.code = code;
    }
}
//# sourceMappingURL=types.js.map