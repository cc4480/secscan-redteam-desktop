const STAMP_BY_ACTOR = {
    coordinator: { name: "MORPHEUS", role: "lead" },
    recon: { name: "OPERATOR", role: "recon" },
    exploiter: { name: "NEO", role: "exploiter" },
    reporter: { name: "ARCHITECT", role: "reporter" },
    architect: { name: "ARCHITECT", role: "architect" },
};
/**
 * The stamp for one execution-side actor, or undefined when the actor
 * is not a fleet seat (`runner`, or no actor at all).
 *
 * @param actor - The actor recorded by the executing path.
 * @returns The seat's stamp, or undefined for a non-seat actor.
 */
export function speakerForActor(actor) {
    return actor === undefined ? undefined : STAMP_BY_ACTOR[actor];
}
/**
 * Event actions whose `actor` is stamped by the executing path itself:
 * the agent loop appends `reasoning` with its own loop role, and the
 * task runner appends `task_complete` with the role it dispatched.
 * Every other action's actor is asserted by whichever handler appended
 * it (some hardcode a seat regardless of the caller), so those records
 * are never trusted as speaker evidence.
 */
const LOOP_STAMPED_ACTIONS = new Set(["reasoning", "task_complete"]);
/**
 * The seat that executed most recently in an engagement: the actor of
 * the last loop-stamped event in the log.
 *
 * @param events - The engagement's events, in log order.
 * @returns The current seat's stamp, or undefined when no loop-stamped
 * event names a fleet seat.
 */
export function currentSeatSpeaker(events) {
    for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i];
        if (LOOP_STAMPED_ACTIONS.has(ev.action))
            return speakerForActor(ev.actor);
    }
    return undefined;
}
/**
 * The seat that authored an engagement's report. The reporter loop
 * runs only on a completed run's report phase — halted and blocked
 * ends are assembled mechanically and dry runs write a literal — so a
 * loop-stamped `reasoning` event from the reporter in the report phase
 * is the genuine authorship record; its absence means no fleet member
 * authored the report and no stamp is issued.
 *
 * @param events - The engagement's events, in log order.
 * @returns The report author's stamp, or undefined when the reporter
 * loop never ran.
 */
export function reportAuthorSpeaker(events) {
    for (const ev of events) {
        if (ev.phase === "report" && ev.actor === "reporter" && ev.action === "reasoning") {
            return speakerForActor("reporter");
        }
    }
    return undefined;
}
/**
 * Per-finding speaker stamps, keyed by finding id, from each finding's
 * recorded `producer`. Findings whose producer is `runner` or absent
 * are omitted — engine records and unstamped findings name no speaker.
 *
 * @param findings - Findings carrying runner-stamped producers.
 * @returns A map from finding id to the producing seat's stamp.
 */
export function findingSpeakers(findings) {
    const out = {};
    for (const f of findings) {
        if (!f.id)
            continue;
        const stamp = speakerForActor(f.producer);
        if (stamp)
            out[f.id] = stamp;
    }
    return out;
}
//# sourceMappingURL=speaker.js.map