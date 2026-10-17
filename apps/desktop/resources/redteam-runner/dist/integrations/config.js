/**
 * INTEGRATIONS — configuration resolution (v0.15.0).
 *
 * Enterprise buyers need findings to flow into their workflows: Jira /
 * ServiceNow ticketing, Slack notifications, SIEM ingestion. Every
 * integration is operator-configured via env / Secure Vault and
 * fail-closed: when unconfigured, the resolver says so with a clear
 * reason, the engagement logs the skip, and the report lists it —
 * the engagement itself is never halted by a missing integration.
 *
 * No finding data leaves the runner except to the operator-configured
 * endpoints. See docs/integrations.md for the full data-flow.
 */
const DEFAULT_PRIORITY_MAP = {
    critical: "1", // Highest
    high: "2", // High
    medium: "3", // Medium
    low: "4", // Low
    info: "5", // Lowest
};
function required(env, names) {
    const missing = names.filter((n) => !(env[n] ?? "").trim());
    if (missing.length > 0)
        return { ok: false, missing };
    const values = {};
    for (const n of names)
        values[n] = env[n].trim();
    return { ok: true, values };
}
const SETUP_HINT = "Set the REDTEAM_* env vars (or Secure Vault equivalents) — see docs/integrations.md.";
export function resolveJiraConfig(env = process.env) {
    const r = required(env, ["REDTEAM_JIRA_BASE_URL", "REDTEAM_JIRA_USER", "REDTEAM_JIRA_API_TOKEN", "REDTEAM_JIRA_PROJECT"]);
    if (!r.ok) {
        return { configured: false, reason: `Jira not configured (missing ${r.missing.join(", ")}). ${SETUP_HINT}` };
    }
    let priorityMap = { ...DEFAULT_PRIORITY_MAP };
    const raw = (env["REDTEAM_JIRA_PRIORITY_MAP"] ?? "").trim();
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            priorityMap = { ...priorityMap, ...parsed };
        }
        catch {
            return { configured: false, reason: `REDTEAM_JIRA_PRIORITY_MAP is not valid JSON — fix or unset it. ${SETUP_HINT}` };
        }
    }
    const baseUrl = r.values["REDTEAM_JIRA_BASE_URL"].replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(baseUrl)) {
        return { configured: false, reason: `REDTEAM_JIRA_BASE_URL must be an http(s) URL. ${SETUP_HINT}` };
    }
    return {
        configured: true,
        baseUrl,
        user: r.values["REDTEAM_JIRA_USER"],
        apiToken: r.values["REDTEAM_JIRA_API_TOKEN"],
        project: r.values["REDTEAM_JIRA_PROJECT"],
        issueType: (env["REDTEAM_JIRA_ISSUE_TYPE"] ?? "").trim() || "Task",
        priorityMap,
    };
}
export function resolveSnowConfig(env = process.env) {
    const r = required(env, ["REDTEAM_SNOW_INSTANCE", "REDTEAM_SNOW_USER", "REDTEAM_SNOW_PASSWORD"]);
    if (!r.ok) {
        return { configured: false, reason: `ServiceNow not configured (missing ${r.missing.join(", ")}). ${SETUP_HINT}` };
    }
    const instance = r.values["REDTEAM_SNOW_INSTANCE"].replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(instance)) {
        return { configured: false, reason: `REDTEAM_SNOW_INSTANCE must be an http(s) URL. ${SETUP_HINT}` };
    }
    return {
        configured: true,
        instance,
        user: r.values["REDTEAM_SNOW_USER"],
        password: r.values["REDTEAM_SNOW_PASSWORD"],
        table: (env["REDTEAM_SNOW_TABLE"] ?? "").trim() || "incident",
    };
}
export function resolveSlackConfig(env = process.env) {
    const url = (env["REDTEAM_SLACK_WEBHOOK_URL"] ?? "").trim();
    if (!url) {
        return { configured: false, reason: `Slack not configured (missing REDTEAM_SLACK_WEBHOOK_URL). ${SETUP_HINT}` };
    }
    if (!/^https:\/\//i.test(url)) {
        return { configured: false, reason: `REDTEAM_SLACK_WEBHOOK_URL must be an https URL. ${SETUP_HINT}` };
    }
    return { configured: true, webhookUrl: url };
}
//# sourceMappingURL=config.js.map