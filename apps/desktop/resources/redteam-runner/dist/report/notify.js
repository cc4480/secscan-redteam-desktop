import { notifySlack, resolveSlackConfig } from "../integrations/index.js";
export async function fireSlack(ctx, ev) {
    try {
        const cfg = resolveSlackConfig();
        if (!cfg.configured)
            return;
        await notifySlack(cfg, {
            ...ev,
            engagementId: ctx.events.engagementId,
            target: ctx.input.target,
            mode: ctx.input.mode,
        });
    }
    catch {
        // best-effort only
    }
}
//# sourceMappingURL=notify.js.map