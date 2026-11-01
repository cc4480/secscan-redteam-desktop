/**
 * MsfSessionManager — the registry of live Meterpreter sessions (W8).
 *
 * A record exists ONLY because a validated exploit run produced the
 * session: the executor snapshots the daemon's session list before the
 * run, diffs it after, and registers the new Meterpreter session here as
 * the mechanical follow-through of that run. There is deliberately no
 * "open a session" entry point — nothing can register a session against
 * a host that was not just exploited, and every record is bound to the
 * exact scope-checked host the exploit ran against.
 *
 * A session is transport, not proof: registration records the validated
 * run's marker, and the executor still proves the session by echoing the
 * runner-built marker through it before any agent command runs.
 *
 * Handles are runner-generated UUIDs; the daemon's numeric session ids
 * never leave the runner, so an agent cannot address a session the
 * runner did not register (a foreign or pre-existing daemon session is
 * unreachable through this registry).
 */
import { randomUUID } from "node:crypto";
const POLL_MS = 50;
/** Stop reading once output has been seen and the channel is quiet this long. */
const IDLE_MS = 200;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export class MsfSessionManager {
    sessions = new Map();
    /**
     * Register a session the executor observed appearing during a
     * validated exploit run. Called by the executor only — see header.
     */
    register(input) {
        const record = {
            handle: randomUUID(),
            daemonId: input.daemonId,
            targetHost: input.targetHost,
            module: input.module,
            payload: input.payload,
            marker: input.marker,
            openedAt: new Date().toISOString(),
        };
        this.sessions.set(record.handle, record);
        return record;
    }
    get(handle) {
        return this.sessions.get(handle);
    }
    list() {
        return [...this.sessions.values()];
    }
    /**
     * Run ONE command through the session and collect its response.
     * Polls the read channel until output goes idle or the deadline hits;
     * the abort signal interrupts the wait immediately.
     * Throws on an unknown/closed handle — callers translate to a refusal.
     */
    async exec(client, handle, command, opts) {
        const record = this.sessions.get(handle);
        if (!record) {
            throw new Error("unknown or closed msf session handle — sessions open only as the mechanical follow-through of a validated exploit run (msf_exec run with a Meterpreter payload)");
        }
        if (opts.signal?.aborted)
            throw new Error("aborted by call signal");
        const line = command.endsWith("\n") ? command : `${command}\n`;
        await client.sessionMeterpreterWrite(record.daemonId, line);
        let output = "";
        let lastDataAt = 0;
        const deadline = Date.now() + opts.timeoutMs;
        for (;;) {
            if (opts.signal?.aborted)
                throw new Error("aborted by call signal");
            const chunk = await client.sessionMeterpreterRead(record.daemonId);
            if (chunk) {
                output += chunk;
                lastDataAt = Date.now();
            }
            const now = Date.now();
            if (lastDataAt > 0 && now - lastDataAt >= IDLE_MS)
                break;
            if (now >= deadline)
                break;
            await sleep(Math.min(POLL_MS, Math.max(1, deadline - now)));
        }
        return { record, output };
    }
    /** Stop the daemon session and forget the handle. False when unknown. */
    async close(client, handle) {
        const record = this.sessions.get(handle);
        if (!record)
            return false;
        this.sessions.delete(handle);
        await client.sessionStop(record.daemonId);
        return true;
    }
}
//# sourceMappingURL=sessions.js.map