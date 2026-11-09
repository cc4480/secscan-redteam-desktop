import { handleBookkeepingTools } from "./bookkeeping.js";
import { handleBridgeTools } from "./bridge.js";
import { handleHostTools } from "./host.js";
import { handleMsfTools } from "./msf.js";
import { handleNmapTools } from "./nmap.js";
import { handleNetTools } from "./net.js";
import { handleNucleiTools } from "./nuclei.js";
import { handlePcAgentTools } from "./pc-agent.js";
import { handleResearchTools } from "./research.js";
import { handleSkillLoadTools } from "./skill-load.js";
import { handleSecscanTools } from "./secscan.js";
import { handleWebTools } from "./web.js";
import { handleXTool } from "./xtool.js";
/* Handler chain note: dispatchToolInner passes the router's per-call
 * dispatch signal (dispatch/timeout.ts budget) as the SEVENTH argument.
 * It sits after the sixth slot because two handlers already own that
 * slot as a test seam (pc-agent's fetch, bridge's client); the chain
 * passes `undefined` there. Handlers that spawn or execute accept the
 * signal and pass it to their executor in place of a private controller,
 * so the dispatch deadline can actually stop the in-flight call. */
const HANDLERS = [
    handleWebTools,
    handleHostTools,
    handleMsfTools,
    handleNucleiTools,
    handleNmapTools,
    handleNetTools,
    handleXTool,
    handlePcAgentTools,
    handleBridgeTools,
    handleSecscanTools,
    handleResearchTools,
    handleSkillLoadTools,
    handleBookkeepingTools,
];
/**
 * Route one tool call through the handler chain.
 * @param ctx - the engagement context.
 * @param role - the calling actor's role.
 * @param phase - the current engagement phase.
 * @param call - the model's tool call.
 * @returns the first claiming handler's result; an unknown-tool denial
 * (tagged repairable, per RC Item 6) when no handler claims the call.
 */
export async function dispatchToolInner(ctx, role, phase, call, signal) {
    const args = call.arguments ?? {};
    ctx.actions++;
    for (const h of HANDLERS) {
        const r = await h(ctx, role, phase, call, args, undefined, signal);
        if (r)
            return r;
    }
    return { result: `DENIED: unknown tool ${call.name}`, repairable: `unknown tool "${call.name}"` };
}
//# sourceMappingURL=handlers.js.map