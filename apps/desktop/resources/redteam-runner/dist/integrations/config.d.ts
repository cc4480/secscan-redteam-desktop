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
export interface JiraConfig {
    configured: true;
    baseUrl: string;
    /** Jira account email for Basic auth. */
    user: string;
    /** API token — password-grade secrecy, never logged. */
    apiToken: string;
    /** Project key, e.g. "SEC". */
    project: string;
    /** Issue type name. Default "Task". */
    issueType: string;
    /** Severity → Jira priority id. Defaults are the stock Jira ids. */
    priorityMap: Record<string, string>;
}
export interface SnowConfig {
    configured: true;
    /** Full instance URL, e.g. https://acme.service-now.com */
    instance: string;
    user: string;
    /** Password — password-grade secrecy, never logged. */
    password: string;
    /** Table to write. Default "incident". */
    table: string;
}
export interface SlackConfig {
    configured: true;
    /** Incoming webhook URL — secret, never logged. */
    webhookUrl: string;
}
export type Unconfigured = {
    configured: false;
    reason: string;
};
export type JiraResolution = JiraConfig | Unconfigured;
export type SnowResolution = SnowConfig | Unconfigured;
export type SlackResolution = SlackConfig | Unconfigured;
export declare function resolveJiraConfig(env?: NodeJS.ProcessEnv): JiraResolution;
export declare function resolveSnowConfig(env?: NodeJS.ProcessEnv): SnowResolution;
export declare function resolveSlackConfig(env?: NodeJS.ProcessEnv): SlackResolution;
