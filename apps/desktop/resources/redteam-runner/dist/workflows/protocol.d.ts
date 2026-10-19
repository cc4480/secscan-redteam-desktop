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
export declare const PROTOCOL_ROLES: readonly ProtocolRole[];
/** Phases every autonomous run walks, with the gate between them. */
export interface ProtocolPhase {
    readonly phase: "authorize" | "plan" | "recon" | "exploit" | "report";
    readonly entryCondition: string;
    readonly exitCondition: string;
    /** True when a human approval is needed to leave this phase. */
    readonly approvalGate: boolean;
}
export declare const PROTOCOL_PHASES: readonly ProtocolPhase[];
/** Non-negotiable rules every agent follows. */
export declare const PROTOCOL_RULES: readonly string[];
/** The report contract: every engagement ends with this, or it is not finished. */
export interface ReportContract {
    readonly sections: readonly {
        readonly id: string;
        readonly required: boolean;
        readonly content: string;
    }[];
    /** Rendered in addition to the Markdown twin. */
    readonly formats: readonly string[];
    readonly severityScale: readonly string[];
}
export declare const REPORT_CONTRACT: ReportContract;
/** One machine-checkable rule list for the protocol test. */
export declare function protocolViolations(input: {
    readonly phase: string;
    readonly findingsWithoutEvidence?: number;
    readonly reportWritten?: boolean;
}): readonly string[];
