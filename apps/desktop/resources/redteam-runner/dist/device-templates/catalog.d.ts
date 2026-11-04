/**
 * Device templates — one explicit template per device class.
 *
 * Every scan runs against a device class, and the class decides three things:
 * which battery a scan selects, which tools the plan may use, and what counts
 * as proof. Those were previously implicit (scattered across target profiles
 * and dispatch handlers); this module makes them explicit and checkable.
 *
 * The catalogue below is the authority for "all of the toolset". A tool that
 * appears in no template is an orphan and `validate.ts` fails on it — that is
 * how "use every tool the device supports" stays true instead of aspirational.
 */
export type DeviceId = 'webapp' | 'secscan' | 'seclayer' | 'windows' | 'linux';
export type ToolGroup = 'engagement' | 'research' | 'web' | 'host' | 'identity' | 'credential' | 'resilience' | 'boundary';
export interface ToolSpec {
    name: string;
    group: ToolGroup;
    /** One line: what this tool answers for the device. */
    purpose: string;
}
export type ScanPhase = 'recon' | 'exploit' | 'report';
export interface DeviceTemplate {
    id: DeviceId;
    /** Human label for the report and the plan prompt. */
    label: string;
    /** One line: what this device class is. */
    summary: string;
    /** Phases in order, every template runs all three. */
    phases: readonly ScanPhase[];
    /** Every tool this device class is expected to exercise. */
    tools: readonly string[];
    /** What counts as proof on this device — the evidence bar. */
    evidence: readonly string[];
    /** Items gated behind an operator-provided prerequisite. */
    prerequisites: readonly string[];
}
export declare const TOOL_CATALOGUE: readonly ToolSpec[];
export declare const DEVICE_TEMPLATES: Record<DeviceId, DeviceTemplate>;
/** Every device template, in a stable order for prompts and reports. */
export declare const DEVICE_ORDER: readonly DeviceId[];
