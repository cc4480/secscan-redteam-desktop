/**
 * INTEGRATIONS — Slack sink (v0.15.0).
 *
 * Engagement lifecycle notifications via incoming webhook: started, phase
 * transitions, completed (with severity counts), and critical-finding
 * alerts. Best-effort by design — a failed notification is logged and
 * never breaks the engagement.
 */
import { defaultHttp } from "./http.js";
import { IntegrationHttpError } from "./http.js";
export function buildSlackPayload(ev) {
    const header = `*RedTeam* \`${ev.engagementId}\` — ${ev.target} (${ev.mode})`;
    let line;
    switch (ev.kind) {
        case "started":
            line = `:crossed_swords: Engagement started.`;
            break;
        case "phase":
            line = `:arrow_forward: Phase: *${ev.phase}*.`;
            break;
        case "completed": {
            const counts = Object.entries(ev.severityCounts ?? {})
                .filter(([, n]) => n > 0)
                .map(([s, n]) => `${s}:${n}`)
                .join(" ");
            line = `:white_check_mark: Engagement completed. Findings — ${counts || "none"}.`;
            break;
        }
        case "critical_finding":
            line = `:rotating_light: *CRITICAL finding* ${ev.findingId}: ${ev.findingTitle}`;
            break;
        case "halted":
            line = `:octagonal_sign: Engagement halted: ${ev.reason}`;
            break;
        case "drift": {
            const d = ev.drift;
            const top = d.topNew.map((f) => `\n• *[${f.severity}]* ${f.id}: ${f.title}`).join("");
            line =
                `:satellite: *Drift alert* — ${d.newCount} new / ${d.remediatedCount} remediated / ` +
                    `${d.reopenedCount} reopened / ${d.needsReviewCount} needs review` +
                    (d.changeRef ? ` (change: ${d.changeRef})` : "") +
                    (top ? `\nNew findings:${top}` : "");
            break;
        }
    }
    return {
        text: `RedTeam ${ev.engagementId}: ${ev.kind}`,
        blocks: [{ type: "section", text: { type: "mrkdwn", text: `${header}\n${line}` } }],
    };
}
/** Fire-and-forget shape: throws on failure so callers can log it. */
export async function notifySlack(cfg, ev, http = defaultHttp()) {
    const payload = buildSlackPayload(ev);
    const res = await http(cfg.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
        throw new IntegrationHttpError(`Slack webhook failed → HTTP ${res.status}`, res.status, text);
    }
}
//# sourceMappingURL=slack.js.map