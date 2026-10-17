/**
 * Streaming engagement records.
 *
 * Three views of the same truth, all under engagements/live/<id>/:
 *  - events.jsonl — one JSON object per line, appended synchronously as each
 *    action happens. This is the LIVE feed: the console tails it.
 *  - state.json  — rewritten on every event: current phase/status, verification
 *    proof, plan, findings so far. One read gives the console everything.
 *  - engagement.md — the human paper trail (Time | Phase | Actor | Action | Result).
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { maybeRotateLog } from "./safety/rotation.js";
export class EventLog {
    dir;
    engagementId;
    state;
    /**
     * v0.23.0: per-instance sequence counter. Previously module-global, which
     * corrupted seq numbering when two engagements ran concurrently in one
     * process (e.g. two UI-launched runs interleaving appends). Each log owns
     * its counter, seeded from its own file state on open.
     */
    seq = 0;
    /**
     * v0.26.0: log rotation. The first seq number living in the CURRENT
     * events.jsonl (1 for a fresh log, N+1 after a rotation archived seqs
     * 1..N). Lets the `log_rotated` audit event name the archived range.
     */
    rotationBase = 1;
    rotation;
    constructor(dir, engagementId, init, rotation) {
        this.dir = dir;
        this.engagementId = engagementId;
        this.rotation = rotation;
        mkdirSync(dir, { recursive: true });
        const now = new Date().toISOString();
        this.state = {
            engagementId,
            target: init.target,
            mode: init.mode,
            objective: init.objective,
            status: "authorizing",
            phase: "authorize",
            verified: false,
            plan: null,
            findings: [],
            eventCount: 0,
            startedAt: now,
            updatedAt: now,
            // Which process owns this run. A console restart, a killed CLI run or a
            // crash leaves a state.json still saying "running" with nobody driving it,
            // and there is no way to tell from the record alone — the status simply
            // lies until something marks it. Recording the owner makes the check
            // mechanical: if that pid is gone, the run is over, whatever the file says.
            ownerPid: process.pid,
        };
        writeFileSync(join(dir, "engagement.md"), `# Engagement ${engagementId}\n\n| Time | Phase | Actor | Action | Result |\n|------|-------|-------|--------|--------|\n`);
        this.persistState();
    }
    /** Reopen an existing engagement dir (for resume / inspection). */
    static open(dir) {
        const statePath = join(dir, "state.json");
        if (!existsSync(statePath))
            throw new Error(`[events] no state.json in ${dir}`);
        const raw = JSON.parse(readFileSync(statePath, "utf8"));
        const log = Object.create(EventLog.prototype);
        log.dir = dir;
        log.engagementId = raw.engagementId;
        log.state = raw;
        log.seq = raw.eventCount;
        return log;
    }
    append(partial) {
        this.rotateIfNeeded();
        return this.writeEvent(partial);
    }
    /**
     * v0.26.0: rotate events.jsonl (and engagement.md alongside it) when the
     * log exceeds the rotation cap. The fresh file leads with a `log_rotated`
     * audit event naming the archive and its seq range, so PoC bundles'
     * `auditSeq` references stay resolvable. Seq numbers stay continuous
     * across rotations — the audit trail is unbroken.
     */
    rotateIfNeeded() {
        if (!this.rotation)
            return;
        const outcome = maybeRotateLog(join(this.dir, "events.jsonl"), this.rotation, {
            firstSeq: this.rotationBase,
            lastSeq: this.seq,
        });
        if (!outcome.rotated)
            return;
        const mdOutcome = maybeRotateLog(join(this.dir, "engagement.md"), this.rotation);
        if (mdOutcome.rotated) {
            writeFileSync(join(this.dir, "engagement.md"), `# Engagement ${this.engagementId}\n\n| Time | Phase | Actor | Action | Result |\n|------|-------|-------|--------|--------|\n` +
                `| ${new Date().toISOString()} | ${this.state.phase} | runner | log rotated | prior rows archived to ${basename(mdOutcome.archivePath)} |\n`);
        }
        this.rotationBase = this.seq + 1;
        this.writeEvent({
            phase: this.state.phase,
            actor: "runner",
            action: "log_rotated",
            result: `events.jsonl rotated to ${basename(outcome.archivePath)} (seq ${outcome.firstSeq}-${outcome.lastSeq}); engagement.md rotated alongside`,
        });
    }
    writeEvent(partial) {
        const ev = {
            ts: new Date().toISOString(),
            seq: ++this.seq,
            engagementId: this.engagementId,
            ...partial,
        };
        appendFileSync(join(this.dir, "events.jsonl"), JSON.stringify(ev) + "\n");
        const mdLine = `| ${ev.ts} | ${ev.phase} | ${ev.actor} | ${ev.action}${ev.attackId ? ` (${ev.attackId})` : ""} | ${oneLine(ev.result)} |\n`;
        appendFileSync(join(this.dir, "engagement.md"), mdLine);
        this.state.eventCount = ev.seq;
        this.state.phase = ev.phase;
        this.state.updatedAt = ev.ts;
        this.persistState();
        return ev;
    }
    /** Merge fields into state.json (status transitions, plan, findings, proof). */
    updateState(patch) {
        Object.assign(this.state, patch, { updatedAt: new Date().toISOString() });
        this.persistState();
    }
    get snapshot() {
        return { ...this.state, findings: [...this.state.findings] };
    }
    persistState() {
        writeFileSync(join(this.dir, "state.json"), JSON.stringify(this.state, null, 2));
    }
}
function oneLine(s) {
    return s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim().slice(0, 300);
}
/** Read-only tail for the console: events after `afterSeq`. */
export function readEvents(dir, afterSeq = 0, limit = 200) {
    const path = join(dir, "events.jsonl");
    if (!existsSync(path))
        return [];
    const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
    const out = [];
    for (const line of lines) {
        try {
            const ev = JSON.parse(line);
            if (ev.seq > afterSeq) {
                out.push(ev);
                if (out.length >= limit)
                    break;
            }
        }
        catch {
            // skip corrupt lines, keep tailing
        }
    }
    return out;
}
/** Read-only state snapshot for the console. */
export function readState(dir) {
    const path = join(dir, "state.json");
    if (!existsSync(path))
        return null;
    try {
        return JSON.parse(readFileSync(path, "utf8"));
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=events.js.map