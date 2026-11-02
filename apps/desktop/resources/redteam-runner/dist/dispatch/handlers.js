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
import { handleSeclayerTools } from "./seclayer.js";
import { handleSeclayerDastTool } from "./seclayer-dast.js";
import { handleWebTools } from "./web.js";
import { handleXTool } from "./xtool.js";
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
    handleSeclayerTools,
    handleSeclayerDastTool,
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
export async function dispatchToolInner(ctx, role, phase, call) {
    const args = call.arguments ?? {};
    ctx.actions++;
    for (const h of HANDLERS) {
        const r = await h(ctx, role, phase, call, args);
        if (r)
            return r;
    }
    return { result: `DENIED: unknown tool ${call.name}`, repairable: `unknown tool "${call.name}"` };
}
//# sourceMappingURL=handlers.js.map