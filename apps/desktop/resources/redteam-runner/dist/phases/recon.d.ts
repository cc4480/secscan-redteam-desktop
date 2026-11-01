import { type Ctx } from "../context.js";
import { type EventLog } from "../events.js";
import { type LocalChannel } from "../local-host/collect.js";
import { type EngagementInput } from "../types.js";
/** The slice of the engagement context the local collection seam needs. */
export interface LocalCollectionContext {
    input: EngagementInput;
    events: Pick<EventLog, "dir" | "append">;
}
/**
 * Q-RP-11 recon seam: for a LOCAL-host engagement, collect the host
 * inventory mechanically through the paired pc-agent channel and write
 * host-inventory.json into the engagement dir — the exact file the
 * report phase reads (report/html/wire.ts). Runs before the recon
 * agent, so the inventory exists whatever the agents do next.
 *
 * Failure is data, not a halt: an unconfigured bridge or a failed
 * collection writes the artifact's `failed` form and recon continues —
 * the report then states the failure honestly instead of rendering no
 * section (which would read as "nothing to report"). Remote
 * engagements are untouched: no artifact, no section.
 * @param ctx - the engagement context (or its local-collection slice).
 * @param channel - collector channel seam for tests; defaults to the
 * env-configured paired bridge channel.
 * @returns true when the engagement is local (artifact written),
 * false when it is not.
 */
export declare function collectLocalHostInventory(ctx: LocalCollectionContext, channel?: LocalChannel): Promise<boolean>;
export declare function reconPhase(ctx: Ctx): Promise<string>;
/** A discrete unit of work: one task, one specialist, one objective. */
