/**
 * Turn integrity for agentLoop (ported from ZimZilla's agent loop,
 * 2026-10-23): progress-aware round caps + deliverable contracts.
 *
 * Two mechanisms protect benchmark-gate integrity:
 *
 * 1. Round caps that announce themselves. The soft cap is a checkpoint
 *    interval, not a limit: at each multiple, a turn whose previous round
 *    produced a successful tool result CONTINUES (a `continuing` event); a
 *    round where every tool failed is the shape that is stuck, and only
 *    that stops at the soft cap. The hard cap is the runaway backstop.
 *    Both stops emit `iteration_cap` (flagged soft/hard). The silent
 *    version — falling out of the round loop and returning like a finished
 *    turn — made a capped turn indistinguishable from a completed one,
 *    which is exactly what a benchmark gate must never be told.
 *
 * 2. Deliverable contracts. A turn may declare a file it must leave
 *    behind. "The model stopped talking" is not "the work is done": when
 *    the model stops with the file missing, the loop nudges it (bounded)
 *    instead of finishing, and the turn always ends with a `deliverable`
 *    event stating {path, written, nudges} read off the disk — never
 *    inferred from the transcript.
 */
import { existsSync } from "node:fs";
import { basename } from "node:path";
/** Default rounds between soft-cap checkpoints when nothing configures one. */
export const DEFAULT_SOFT_ROUND_CAP = 8;
export class TurnIntegrity {
    ctx;
    phase;
    /** min(caller's maxTurns, hard cap) — the loop's real round budget. */
    effectiveMaxTurns;
    /** How the loop ended; "hard" until the model or the soft cap says otherwise. */
    stopReason = "hard";
    softCap;
    hardCap;
    /** Whether the previous round advanced the work. */
    progressed = false;
    continuations = 0;
    nudges = 0;
    deliverable;
    label;
    maxNudges;
    constructor(ctx, phase, maxTurns, caps, deliverable) {
        this.ctx = ctx;
        this.phase = phase;
        this.softCap = caps?.softCapRounds ?? ctx.config.softRoundCap ?? DEFAULT_SOFT_ROUND_CAP;
        this.hardCap = caps?.hardCapRounds ?? ctx.config.hardRoundCap ?? maxTurns;
        this.effectiveMaxTurns = Math.max(1, Math.min(maxTurns, this.hardCap));
        this.deliverable = deliverable;
        this.label = deliverable ? (deliverable.label ?? basename(deliverable.path)) : "";
        this.maxNudges = deliverable?.maxNudges ?? 2;
    }
    /**
     * Soft-cap checkpoint, called at the top of every round with the number
     * of rounds completed so far. Reads the PREVIOUS round's progress verdict,
     * then resets it for the round about to start — recomputing per round is
     * what keeps a stale success from carrying a stuck loop past the cap.
     * Returns true when the turn must stop now (soft cap, stuck).
     */
    checkpoint(roundsCompleted) {
        let stop = false;
        if (roundsCompleted > 0 && this.softCap > 0 && roundsCompleted % this.softCap === 0) {
            if (!this.progressed) {
                this.ctx.events.append({
                    phase: this.phase,
                    actor: "runner",
                    action: "iteration_cap",
                    result: `iteration_cap (soft): stopped at round ${roundsCompleted} (soft cap ${this.softCap}) — the previous round produced ` +
                        `no successful tool result. This turn was CAPPED, not completed.`,
                });
                this.stopReason = "soft";
                stop = true;
            }
            else {
                this.continuations++;
                this.ctx.events.append({
                    phase: this.phase,
                    actor: "runner",
                    action: "continuing",
                    result: `continuing: soft cap ${this.softCap} passed at round ${roundsCompleted} — the previous round made progress ` +
                        `(continuation ${this.continuations}). The turn continues.`,
                });
            }
        }
        this.progressed = false;
        return stop;
    }
    /** Record one dispatched tool result's verdict for the current round. */
    noteToolResult(progressed) {
        if (progressed)
            this.progressed = true;
    }
    /** The model finished on its own (no cap involved). */
    markFinished() {
        this.stopReason = "finished";
    }
    /**
     * The model stopped calling tools. When a deliverable is declared, still
     * missing, and nudges remain, returns the nudge prompt (and records the
     * `deliverable_nudge` event); otherwise returns null and the turn may end.
     */
    deliverableNudge() {
        if (!this.deliverable || this.nudges >= this.maxNudges || existsSync(this.deliverable.path))
            return null;
        this.nudges++;
        this.ctx.events.append({
            phase: this.phase,
            actor: "runner",
            action: "deliverable_nudge",
            result: `Deliverable ${this.deliverable.path} missing when the model stopped; nudge ${this.nudges}/${this.maxNudges}.`,
        });
        return (`You stopped before writing ${this.label} to ${this.deliverable.path} — write it now. ` +
            `That file is this turn's deliverable, and nothing else counts as finishing.`);
    }
    /**
     * Call once after the loop exits without throwing. A "hard" stop means
     * the round budget ran out with the model still working — announce it
     * like the soft cap does: a turn never ends at a limit without saying
     * which one. Then state the deliverable's fate, when one was declared.
     */
    finalize() {
        if (this.stopReason === "hard") {
            this.ctx.events.append({
                phase: this.phase,
                actor: "runner",
                action: "iteration_cap",
                result: `iteration_cap (hard): stopped at round ${this.effectiveMaxTurns} (hard cap ${this.hardCap}) with the model ` +
                    `still calling tools. This turn was CAPPED, not completed.`,
            });
        }
        if (this.deliverable) {
            this.ctx.events.append({
                phase: this.phase,
                actor: "runner",
                action: "deliverable",
                result: JSON.stringify({ path: this.deliverable.path, written: existsSync(this.deliverable.path), nudges: this.nudges }),
            });
        }
    }
}
//# sourceMappingURL=turn-integrity.js.map