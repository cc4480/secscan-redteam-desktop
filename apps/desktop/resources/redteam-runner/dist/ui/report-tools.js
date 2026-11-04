/**
 * The report half of the chat-shaped engagement surface
 * (engagement-tools.ts owns launch + status): delivery of the finished
 * report, and — the repair path the deliverables diagnosis required —
 * regeneration of the deliverable set from an engagement's recorded
 * state when a closing artifact is missing.
 */
import { join } from "node:path";
import { engagementDir } from "./store.js";
import { readEvents, readState, TERMINAL_STATUSES } from "../events.js";
import { findingSpeakers, reportAuthorSpeaker } from "./speaker.js";
import { DELIVERABLE_FILES, deliverableToolFields, verifyDeliverables } from "../report/deliverables.js";
import { regenerateReport } from "../report/regenerate.js";
const ID_ONLY = () => ({
    type: "object",
    properties: { id: { type: "string", description: "Engagement id" } },
    required: ["id"],
    additionalProperties: false,
});
/**
 * Per-finding speaker stamps from a report.json body: the recorded
 * findings' producers, stamped by the runner at record time. An
 * unreadable or absent report.json yields no stamps.
 *
 * @param raw - The report.json text, or null when absent.
 * @returns Finding-id → speaker stamp, possibly empty.
 */
function reportJsonSpeakers(raw) {
    if (!raw)
        return {};
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed.findings) ? findingSpeakers(parsed.findings) : {};
    }
    catch {
        return {};
    }
}
/** engagement_report — the finished report, for delivery in the thread. */
export const reportTool = {
    name: "engagement_report",
    description: "The finished report for an engagement: the report content for delivery in the thread, plus the in-app artifact paths. " +
        "Returns ready:false while the run is still going — keep polling engagement_status instead of treating that as an error. " +
        "When the run has ended without a report (a recorded end, or a non-terminal record with no live run behind it), ready:false " +
        "instead names engagement_regenerate_report as the repair. " +
        "When the result names a speaker, that is the fleet seat whose recorded execution authored the report — attribute the delivery to that seat.",
    inputSchema: ID_ONLY(),
    run: async (store, a) => {
        const id = String(a["id"] ?? "");
        const content = store.readTextArtifact(id, "report.md");
        if (content === null) {
            // No report file: distinguish a run that has not finished from an id
            // nothing knows. The store record or a state file proves existence.
            const dir = engagementDir(store.engagementsDir, id);
            const st = dir ? readState(dir) : null;
            const rec = store.get(id);
            if (!st && !rec)
                return { status: 404, body: { error: "unknown engagement" } };
            const status = st?.status ?? rec?.status ?? "starting";
            // The run has ended without a report when its recorded status is
            // terminal, or when no live record exists in the store at all: a
            // process-killed run never records a terminal status, and with
            // nobody behind the record nothing will ever write the file —
            // promising a future report would be false, so name the repair.
            const ended = TERMINAL_STATUSES.has(status) || !rec;
            return {
                status: 200,
                body: {
                    id,
                    ready: false,
                    status,
                    ...(st ? { phase: st.phase } : {}),
                    summary: ended
                        ? `Engagement ${id} has no report yet (status: ${status}). The run has ended without a report — call engagement_regenerate_report to regenerate the deliverable set from its recorded state.`
                        : `Engagement ${id} has no report yet (status: ${status}). Keep polling engagement_status; the report lands when the run completes.`,
                },
            };
        }
        // report.md exists, so state.json does too (engagementDir requires it)
        // and the directory join is safe. Q-DELIVERABLES-AUTOFIRE: deliverableToolFields.
        const dir = engagementDir(store.engagementsDir, id);
        // Speaker stamps (ui/speaker.ts): the report's author, present only
        // when the reporter loop genuinely ran (a halted/blocked end's
        // mechanical report names no author), and per-finding producers
        // from the recorded report.json.
        const st = readState(dir);
        // S6-H2a: the Scribe gate's outcome, from the stamps the gate already
        // recorded on state — an unsigned set must not read in-thread as
        // indistinguishable from a signed one. No stamp recorded: no field,
        // never a fabricated signing.
        const signoff = st?.artifactSignoff
            ? { signed: true, cycles: st.artifactSignoff.cycles }
            : st?.artifactUnsigned
                ? {
                    signed: false,
                    cycles: st.artifactUnsigned.cycles,
                    reason: st.artifactUnsigned.reason,
                    defectCount: st.artifactUnsigned.defects.length,
                }
                : undefined;
        const speaker = st
            ? reportAuthorSpeaker(readEvents(dir, Math.max(0, st.eventCount - 1000), 1000))
            : undefined;
        const speakers = reportJsonSpeakers(store.readTextArtifact(id, "report.json"));
        return {
            status: 200,
            body: {
                id,
                ready: true,
                // S2-H10: a halted run's mechanical report is also ready:true —
                // carry the recorded status so a consumer keying on ready can
                // tell a halt/blocked report from a finished one.
                ...(st ? { status: st.status } : {}),
                reportPath: join(dir, "report.md"),
                ...deliverableToolFields(dir),
                ...(signoff ? { signoff } : {}),
                ...(speaker ? { speaker } : {}),
                ...(Object.keys(speakers).length > 0 ? { findingSpeakers: speakers } : {}),
                content,
                summary: `Report for engagement ${id} is ready. Deliver it in this thread — it lives in the app; do not link out to any external report.`,
            },
        };
    },
};
/** Recorded ends regeneration may run on are TERMINAL_STATUSES (shared
 * from events.ts) — a live run owns its own report phase and must never
 * be re-fired underneath it. */
/** engagement_regenerate_report — re-fire report generation for a
 * recorded engagement end whose deliverable set is incomplete. */
export const regenerateTool = {
    name: "engagement_regenerate_report",
    description: "Re-fire report generation for a finished engagement whose deliverable set is incomplete (engagement_status names the " +
        "missing files): reassembles report.html and the sibling artifacts from the engagement's recorded state and verifies " +
        "the full set on disk. A complete set is a no-op success. Runs on a recorded end (complete / halted / blocked), or on a " +
        "dead end — a non-terminal record with no live run behind it, regenerated as an ended, uncompleted run with no grade — " +
        "never on a live run, and only on an engagement that exists.",
    inputSchema: ID_ONLY(),
    run: async (store, a) => {
        const id = String(a["id"] ?? "");
        const dir = engagementDir(store.engagementsDir, id);
        if (!dir) {
            if (store.get(id)) {
                return {
                    status: 409,
                    body: { error: `engagement ${id} has no recorded state yet — there is nothing to regenerate from` },
                };
            }
            return { status: 404, body: { error: "unknown engagement" } };
        }
        const st = readState(dir);
        if (!st)
            return { status: 404, body: { error: "unknown engagement" } };
        // A non-terminal recorded status is a dead end — eligible for
        // regeneration — only when the store holds no live record for the
        // engagement at all: its process is gone (killed, crashed, or the
        // console restarted) and no close ever ran. Any live record, running
        // or not, keeps the refusal exactly as before.
        const liveRec = store.get(id);
        const deadEnd = !TERMINAL_STATUSES.has(st.status) && liveRec === undefined;
        if (liveRec?.running || (!TERMINAL_STATUSES.has(st.status) && !deadEnd)) {
            return {
                status: 409,
                body: {
                    error: `engagement ${id} is ${liveRec?.running ? "still running" : `not at a recorded end (status: ${st.status})`} — ` +
                        "regeneration runs on a recorded end; poll engagement_status instead",
                },
            };
        }
        const before = verifyDeliverables(dir);
        if (before.ok && st.deliverableFailed !== true) {
            return {
                status: 200,
                body: {
                    id,
                    regenerated: false,
                    ...deliverableToolFields(dir),
                    summary: `Engagement ${id}'s deliverable set is already complete (${DELIVERABLE_FILES.join(", ")}) — nothing to regenerate. ` +
                        "Deliver it with engagement_report.",
                },
            };
        }
        try {
            const outcome = regenerateReport(dir, { deadEnd });
            return {
                status: 200,
                body: {
                    id,
                    regenerated: true,
                    ok: outcome.ok,
                    ...deliverableToolFields(dir),
                    ...(outcome.ok ? {} : { missing: outcome.missing }),
                    summary: outcome.ok
                        ? `Deliverable set for engagement ${id} regenerated from its recorded state and verified complete: ${DELIVERABLE_FILES.join(", ")}. Deliver it with engagement_report.`
                        : `Regeneration for engagement ${id} ran but the set is still incomplete — missing: ${outcome.missing.join(", ")}. The gap is recorded on the engagement's deliverable_failed record.`,
                },
            };
        }
        catch (err) {
            return { status: 500, body: { error: `report regeneration failed for engagement ${id}: ${err.message}` } };
        }
    },
};
//# sourceMappingURL=report-tools.js.map