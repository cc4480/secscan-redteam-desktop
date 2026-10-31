/**
 * INTEGRATIONS — ServiceNow sink (v0.15.0).
 *
 * Same shape as the Jira sink via the REST table API: one record per
 * confirmed finding, work-notes + state updates on retest. Default table
 * is "incident" (overridable via REDTEAM_SNOW_TABLE for customers that
 * route vulns to sn_vul_vulnerability or a custom table).
 *
 * Ticket content is the finding + proof reference + fix guidance. No SLA
 * language; no remediation promises.
 */
import { basicAuth, defaultHttp, requestJson } from "./http.js";
/** ServiceNow urgency/impact: 1=High, 2=Medium, 3=Low. */
const URGENCY = {
    critical: "1",
    high: "2",
    medium: "2",
    low: "3",
    info: "3",
};
function buildSnowShortDescription(input) {
    const f = input.finding;
    return `[${f.severity.toUpperCase()}] ${f.title} (${f.id}, ${input.target})`.slice(0, 160);
}
function buildSnowDescription(input) {
    const { finding: f, bundle, engagementId, target } = input;
    const parts = [
        `SecScan RedTeam finding ${f.id} — confirmed during engagement ${engagementId} against ${target}.`,
        `Severity: ${f.severity}. ATT&CK: ${f.attackIds.join(", ") || "n/a"}.`,
        ``,
        `Evidence:`,
        f.evidence.slice(0, 1500),
    ];
    if (bundle) {
        parts.push(``, `Proof of exploitation (bundle ${bundle.bundleId}, ${bundle.validationTier} tier):`, bundle.proves.slice(0, 1500), `Full bundle: poc/${f.id}.json.`);
    }
    parts.push(``, `Remediation guidance:`, f.fix.slice(0, 1500));
    parts.push(``, `Created by the red-team runner. Asserts the finding and its evidence — nothing more.`);
    return parts.join("\n").slice(0, 4000);
}
function authHeaders(cfg) {
    return { Authorization: basicAuth(cfg.user, cfg.password), Accept: "application/json" };
}
function tableUrl(cfg) {
    return `${cfg.instance}/api/now/table/${encodeURIComponent(cfg.table)}`;
}
/** Create one record per finding. Returns the record sys_id. */
export async function createSnowRecord(cfg, input, http = defaultHttp()) {
    const sev = URGENCY[input.finding.severity] ?? "3";
    const res = (await requestJson(http, "POST", tableUrl(cfg), authHeaders(cfg), {
        short_description: buildSnowShortDescription(input),
        description: buildSnowDescription(input),
        urgency: sev,
        impact: sev,
        category: "Security",
        assignment_group: "",
        comments: `Red-team finding ${input.finding.id} (${input.finding.severity}). See description for evidence.`,
    }));
    const sysId = res.result?.sys_id;
    if (!sysId)
        throw new Error("ServiceNow create returned no sys_id");
    return sysId;
}
/**
 * Update a record with retest news. When verifiedFixed, attempt to resolve
 * (incident state 6); otherwise leave a work note. Returns what was done.
 */
export async function updateSnowRecord(cfg, sysId, note, verifiedFixed, http = defaultHttp()) {
    const body = { work_notes: note.slice(0, 4000) };
    if (verifiedFixed) {
        body["state"] = "6"; // Resolved (incident table)
        body["close_notes"] = note.slice(0, 4000);
    }
    await requestJson(http, "PUT", `${tableUrl(cfg)}/${encodeURIComponent(sysId)}`, authHeaders(cfg), body);
    return verifiedFixed ? "resolved" : "noted";
}
//# sourceMappingURL=snow.js.map