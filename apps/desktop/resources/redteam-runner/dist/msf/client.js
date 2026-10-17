/**
 * MsfClient — thin typed wrapper over msfrpc (msfCall).
 *
 * Covers what the bridge needs: auth, module search, console-based module
 * execution WITH output capture (the evidence for "command execution
 * achieved"), and session hygiene (a validation payload must never leave a
 * session behind — any unexpected session is stopped immediately).
 *
 * All methods throw MsfTransportError / MsfAuthError on failure; callers
 * translate those into DENIED/failed results with redacted messages.
 */
import { msfCall } from "./protocol.js";
import { MSFRPC_SETUP_INSTRUCTIONS } from "./policy.js";
export class MsfAuthError extends Error {
    constructor(message) {
        super(message);
        this.name = "MsfAuthError";
    }
}
const CONSOLE_POLL_MS = 750;
function asRecord(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v) ? v : {};
}
function asString(v) {
    return typeof v === "string" ? v : "";
}
export class MsfClient {
    request;
    token = null;
    constructor(request) {
        this.request = request;
    }
    /** Authenticate. Throws MsfAuthError (with setup instructions) on failure. */
    async login(user, pass) {
        const res = asRecord(await msfCall(this.request, "auth.login", null, [user, pass]));
        if (res["result"] === "success" && typeof res["token"] === "string") {
            this.token = res["token"];
            return;
        }
        throw new MsfAuthError(`[msf] msfrpcd authentication failed for user ${JSON.stringify(user)} — check ${"REDTEAM_MSFRPC_USER"}/${"REDTEAM_MSFRPC_PASS"}.\n${MSFRPC_SETUP_INSTRUCTIONS}`);
    }
    /** Raw msfrpc result — a map for most methods, an array for module.search. */
    async callAny(method, args) {
        if (!this.token)
            throw new MsfAuthError("[msf] not authenticated — call login() first");
        return msfCall(this.request, method, this.token, args);
    }
    async call(method, args) {
        return asRecord(await this.callAny(method, args));
    }
    /**
     * Search the module database. Query uses msf search syntax (cve:, type:, platform:, name:…).
     *
     * msfrpcd returns a BARE ARRAY here (unlike module.exploits, which wraps its
     * results in `{modules:[…]}`). Reading only `res["modules"]` therefore found
     * nothing, so accept either shape — a real daemon sends the array.
     */
    async searchModules(query) {
        const res = await this.callAny("module.search", [query]);
        const list = Array.isArray(res) ? res : asRecord(res)["modules"];
        if (!Array.isArray(list))
            return [];
        return list.map((m) => {
            const r = asRecord(m);
            return {
                type: asString(r["type"]),
                name: asString(r["name"]),
                fullname: asString(r["fullname"]) || asString(r["name"]),
                rank: asString(r["rank"]),
                description: asString(r["description"]),
                disclosureDate: typeof r["disclosure_date"] === "string" ? r["disclosure_date"] : undefined,
            };
        });
    }
    /** Current sessions (id → info). Used for hygiene: validation runs must not leave sessions. */
    async sessionList() {
        const res = await this.call("session.list", []);
        const out = {};
        for (const [k, v] of Object.entries(res))
            out[k] = asRecord(v);
        return out;
    }
    async sessionStop(id) {
        await this.call("session.stop", [id]);
    }
    /**
     * Run a module in a throwaway console and capture its output.
     *
     * Flow: console.create → `use <type>/<fullname>` → `set` each option →
     * `set PAYLOAD`/`set CMD` (for exploits with generic payloads) → `run`
     * (foreground, so output streams to the console) → poll console.read
     * until idle/timeout/abort → console.destroy (always).
     *
     * The console is destroyed on abort — that is the kill switch for a
     * running module: destroying the console kills whatever it was doing.
     */
    async runModuleConsole(args) {
        const created = await this.call("console.create", []);
        const cid = asString(created["id"]);
        if (!cid)
            throw new Error("[msf] console.create returned no console id");
        let output = "";
        let aborted = false;
        // Every value written to the console becomes part of a newline-delimited
        // command stream, so a single CR/LF in an agent-supplied module name or
        // option value would inject an extra console command. Strip them so the
        // stream stays one-command-per-line no matter what the caller passed.
        const clean = (s) => s.replace(/[\r\n]+/g, " ").trim();
        const write = async (data) => {
            await this.call("console.write", [cid, data]);
        };
        const destroy = async () => {
            try {
                await this.call("console.destroy", [cid]);
            }
            catch {
                /* best effort — the console may already be gone */
            }
        };
        try {
            if (args.signal?.aborted)
                aborted = true;
            const onAbort = () => {
                aborted = true;
            };
            args.signal?.addEventListener("abort", onAbort, { once: true });
            try {
                await write(`use ${args.moduleType}/${clean(args.fullname)}\n`);
                for (const [k, v] of Object.entries(args.options)) {
                    await write(`set ${clean(k)} ${clean(v)}\n`);
                }
                if (args.payload)
                    await write(`set PAYLOAD ${clean(args.payload)}\n`);
                if (args.cmd)
                    await write(`set CMD ${clean(args.cmd)}\n`);
                await write(`run\n`);
                const deadline = Date.now() + args.timeoutMs;
                // Race each poll against the abort signal: a hanging console.read
                // must not delay the kill switch. The dangling read promise is
                // harmless — we break out and destroy the console.
                const abortedPromise = new Promise((resolve) => {
                    if (args.signal?.aborted)
                        resolve(null);
                    else
                        args.signal?.addEventListener("abort", () => resolve(null), { once: true });
                });
                for (;;) {
                    const raced = await Promise.race([
                        this.call("console.read", [cid]).then((r) => ({ read: r })),
                        abortedPromise.then(() => ({ read: null })),
                    ]);
                    if (raced.read === null) {
                        aborted = true;
                        break;
                    }
                    const read = raced.read;
                    output += asString(read["data"]);
                    const busy = read["busy"] === true;
                    if (!busy)
                        break;
                    if (Date.now() >= deadline)
                        break;
                    await new Promise((r) => setTimeout(r, CONSOLE_POLL_MS));
                }
                const completed = !aborted && Date.now() < deadline;
                return { output, completed, timedOut: !completed && !aborted, aborted };
            }
            finally {
                args.signal?.removeEventListener("abort", onAbort);
            }
        }
        finally {
            await destroy();
        }
    }
}
//# sourceMappingURL=client.js.map