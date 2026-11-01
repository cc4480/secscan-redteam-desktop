/**
 * The autonomous engagement protocol.
 *
 * Every agent and subagent follows this. It is data, not prose, so the prompt
 * builder, the protocol tests and the report renderer all read the same rules.
 * The protocol encodes the two things that make an autonomous red-team run
 * trustworthy: nobody acts without evidence, and nobody finishes without the
 * report contract.
 */

/** A role on the team, its mandate, and what it may never do. */
export interface ProtocolRole {
  readonly id: "coordinator" | "recon" | "exploiter" | "reporter";
  readonly mandate: string;
  readonly may: readonly string[];
  readonly never: readonly string[];
  /** Artifacts this role must leave in the shared ledger. */
  readonly outputs: readonly string[];
}

/** The roles, in command order. */
export const PROTOCOL_ROLES: readonly ProtocolRole[] = [
  {
    id: "coordinator",
    mandate: "Own the operation: authorize, plan, task, sign off, abort.",
    may: ["decompose the objective", "spawn specialists", "re-task or redirect", "abort the engagement"],
    never: ["run probes itself", "write the report", "bypass the auth gate", "continue past a stop condition"],
    outputs: ["operation plan", "sign-off notes", "redirect decisions"],
  },
  {
    id: "recon",
    mandate: "Map the surface without touching it.",
    may: ["secscan_exec", "http_probe GET/HEAD", "nmap/nuclei recon-safe actions", "write the shared target map"],
    never: ["craft payloads", "exploit", "confirm by touching", "report a guess as a fact"],
    outputs: ["target map entries", "fingerprint", "attack-surface brief"],
  },
  {
    id: "exploiter",
    mandate: "Test hypotheses; prove or kill them.",
    may: ["http_probe", "burst_probe", "sqlmap/ffuf/gobuster/nikto", "nuclei run", "msf run (exploit phase)", "record_finding / record_killed"],
    never: ["repeat a payload verbatim", "claim a finding on one observation", "write client prose", "touch out-of-scope hosts"],
    outputs: ["verdicts (confirmed/killed)", "payload patterns", "proof observations"],
  },
  {
    id: "reporter",
    mandate: "Write the client-facing report from the ledger only.",
    may: ["read findings and verdicts", "order by severity", "state honest limits", "render the report"],
    never: ["invent a finding", "soften a verdict", "drop a killed hypothesis without a reason", "probe"],
    outputs: ["report.html", "report.md", "honest-limits section"],
  },
] as const;

/** Phases every autonomous run walks, with the gate between them. */
export interface ProtocolPhase {
  readonly phase: "authorize" | "plan" | "recon" | "exploit" | "report";
  readonly entryCondition: string;
  readonly exitCondition: string;
  /** True when a human approval is needed to leave this phase. */
  readonly approvalGate: boolean;
}

export const PROTOCOL_PHASES: readonly ProtocolPhase[] = [
  { phase: "authorize", entryCondition: "target supplied", exitCondition: "ownership verified by the SecScan server; ROE parsed", approvalGate: false },
  { phase: "plan", entryCondition: "authorized", exitCondition: "one plan, every step with ATT&CK id + expected observation", approvalGate: true },
  { phase: "recon", entryCondition: "plan signed off", exitCondition: "target map non-empty; fingerprint recorded", approvalGate: true },
  { phase: "exploit", entryCondition: "recon signed off", exitCondition: "every selected battery cell probed or honestly blocked", approvalGate: false },
  { phase: "report", entryCondition: "exploit complete or halted", exitCondition: "report.html + report.md written; honest limits present", approvalGate: false },
] as const;

/** Non-negotiable rules every agent follows. */
export const PROTOCOL_RULES: readonly string[] = [
  "Authorize first: no packet leaves the runner until ownership verification passed; the gate fails closed.",
  "One tool call per turn, then observe. A plan you never observe against is a guess.",
  "Two independent observations before any finding is called confirmed.",
  "A killed hypothesis is a result: record it with the killing observation.",
  "Never repeat a failed payload verbatim; mutate with stated intent.",
  "Write every discovery to the shared target map in the same turn you make it.",
  "Stay inside the ROE scope: out-of-scope hosts are refused before the packet, not after.",
  "Honest limits beat fake coverage: declare not-covered items with a reason code.",
  "The report is written from the ledger only; nothing enters it that was not observed.",
  "Stop conditions are absolute: auth-gate attempt, ROE breach, production impact, kill switch.",
] as const;

/** The report contract: every engagement ends with this, or it is not finished. */
export interface ReportContract {
  readonly sections: readonly { readonly id: string; readonly required: boolean; readonly content: string }[];
  /** The deliverable set: the report twins, the findings sheet, the
   * editable DOCX copy, and the package zip carrying them all. */
  readonly formats: readonly string[];
  readonly severityScale: readonly string[];
}

export const REPORT_CONTRACT: ReportContract = {
  sections: [
    { id: "narrative", required: true, content: "2-3 sentence operation narrative for the console header" },
    { id: "executive-summary", required: true, content: "what was tested, the verdict in plain language" },
    { id: "authorization", required: true, content: "ownership proof (domain, timestamp, method)" },
    { id: "scope", required: true, content: "in-scope hosts, excluded techniques, blackout windows" },
    { id: "methodology", required: true, content: "phases with ATT&CK IDs per step; red/black notes" },
    { id: "findings", required: true, content: "severity-ordered; evidence (two observations), ATT&CK, fix, retest note" },
    { id: "detection-gaps", required: false, content: "where defenses did/didn't react, mapped to ATT&CK" },
    { id: "honest-limits", required: true, content: "not covered, deferred, needs-prerequisite - with reason codes" },
    { id: "compliance", required: false, content: "PCI DSS 4.0.1 11.4 / SOC 2 / ISO 27001 mapping when requested" },
    { id: "appendix-coverage", required: true, content: "battery cells probed, blocked and skipped, per family" },
  ],
  formats: ["report.html", "report.md", "report.json", "report.txt", "findings.csv", "report.docx", "report-package.zip"],
  severityScale: ["critical", "high", "medium", "low", "info"],
} as const;

/** One machine-checkable rule list for the protocol test. */
export function protocolViolations(input: { readonly phase: string; readonly findingsWithoutEvidence?: number; readonly reportWritten?: boolean }): readonly string[] {
  const problems: string[] = []
  if ((input.findingsWithoutEvidence ?? 0) > 0) problems.push("finding without two independent observations")
  if (input.reportWritten === false && input.phase === "report") problems.push("report phase ended without report.html")
  return problems
}
