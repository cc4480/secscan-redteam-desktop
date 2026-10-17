/**
 * INTEGRATIONS — Jira sink (v0.15.0).
 *
 * One issue per confirmed finding: summary, severity→priority mapping,
 * description with proof-bundle reference and remediation guidance,
 * labels carrying the ATT&CK IDs + CVE. Retest loop: comment with the
 * verdict; when a finding is verified fixed, attempt the Done/Resolve
 * transition (best-effort — a comment is always left regardless).
 *
 * Ticket content is the finding + proof reference + fix guidance. No SLA
 * language is ever written; no remediation is ever promised.
 */
import type { Finding } from "../types.js";
import type { PocBundle } from "../proof/bundle.js";
import type { JiraConfig } from "./config.js";
import { type HttpFn } from "./http.js";
export interface JiraIssueInput {
    finding: Finding;
    bundle: PocBundle | null;
    engagementId: string;
    target: string;
}
export declare function buildJiraSummary(input: JiraIssueInput): string;
export declare function buildJiraLabels(input: JiraIssueInput): string[];
/**
 * Create one issue per finding. Returns the issue key (e.g. "SEC-123").
 * Throws IntegrationHttpError on failure — callers catch and record.
 */
export declare function createJiraIssue(cfg: JiraConfig, input: JiraIssueInput, http?: HttpFn): Promise<string>;
export declare function commentJiraIssue(cfg: JiraConfig, issueKey: string, paragraphs: string[], http?: HttpFn): Promise<void>;
/**
 * Best-effort resolve transition: look up available transitions and pick
 * one named like Done/Resolve(d)/Close(d). Returns false when none matches
 * (the caller still leaves a comment — the ticket is never left silent).
 */
export declare function transitionJiraIssueDone(cfg: JiraConfig, issueKey: string, http?: HttpFn): Promise<boolean>;
