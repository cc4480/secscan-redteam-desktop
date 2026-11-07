/**
 * Speaker stamps for the chat-shaped engagement surface: which fleet
 * seat actually did the work an engagement tool result reports, so the
 * app session can name the speaker instead of a bare model id.
 *
 * A stamp is derived ONLY from execution-side records the runner itself
 * wrote — the agent loop's `actor` on its own `reasoning` events, the
 * task runner's `actor` on `task_complete`, and a finding's `producer`
 * as stamped by the dispatch path from the executing role. Nothing here
 * parses model output, accepts a tool argument, or infers a seat from
 * content, model id, or step order: a stamp exists only where the
 * execution record proves which seat ran. Records stamped `runner`
 * (engine mechanics, not a fleet seat) or carrying no stamp produce NO
 * speaker — the surface then renders exactly as it did before this
 * wire existed.
 *
 * The seat names are the fleet cast (prompts/fleet-assembly.ts
 * SOUL_BY_ROLE): the coordinator seat is MORPHEUS, recon is TANK,
 * the exploiter is NEO, and the review and report seats are AGENT SMITH and TRINITY.
 * The role word is the client chip's vocabulary: the coordinator maps
 * to `lead`; the remaining seats keep their runner role names.
 */
import type { ActorRole, EngagementEvent, Finding } from "../types.js";

/** The role words the client chip renders beside a speaker's name. */
export type SpeakerRole = "lead" | "recon" | "exploiter" | "architect" | "reporter";

/** One stamped speaker: the fleet member's name and its chip role. */
export interface SpeakerStamp {
  name: string;
  role: SpeakerRole;
}

const STAMP_BY_ACTOR: Partial<Record<ActorRole, SpeakerStamp>> = {
  coordinator: { name: "MORPHEUS", role: "lead" },
  recon: { name: "TANK", role: "recon" },
  exploiter: { name: "NEO", role: "exploiter" },
  reporter: { name: "TRINITY", role: "reporter" },
  architect: { name: "AGENT SMITH", role: "architect" },
};

/**
 * The stamp for one execution-side actor, or undefined when the actor
 * is not a fleet seat (`runner`, or no actor at all).
 *
 * @param actor - The actor recorded by the executing path.
 * @returns The seat's stamp, or undefined for a non-seat actor.
 */
export function speakerForActor(actor: ActorRole | undefined): SpeakerStamp | undefined {
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
const LOOP_STAMPED_ACTIONS: ReadonlySet<string> = new Set(["reasoning", "task_complete"]);

/**
 * The seat that executed most recently in an engagement: the actor of
 * the last loop-stamped event in the log.
 *
 * @param events - The engagement's events, in log order.
 * @returns The current seat's stamp, or undefined when no loop-stamped
 * event names a fleet seat.
 */
export function currentSeatSpeaker(events: readonly EngagementEvent[]): SpeakerStamp | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]!;
    if (LOOP_STAMPED_ACTIONS.has(ev.action)) return speakerForActor(ev.actor);
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
export function reportAuthorSpeaker(events: readonly EngagementEvent[]): SpeakerStamp | undefined {
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
export function findingSpeakers(findings: readonly Finding[]): Record<string, SpeakerStamp> {
  const out: Record<string, SpeakerStamp> = {};
  for (const f of findings) {
    if (!f.id) continue;
    const stamp = speakerForActor(f.producer);
    if (stamp) out[f.id] = stamp;
  }
  return out;
}
