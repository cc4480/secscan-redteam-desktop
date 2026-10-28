/**
 * Seam type shim — NOT a vendored copy.
 *
 * redTeamProbes.ts, probeDescriptors.ts and scanTypes.ts type-import
 * EmitFn from "./scanEvents.js". The live event bus behind it is
 * skip-set scan plumbing (the runner has its own event log); only
 * the callback contract is declared here. Consumers pass no emitter
 * (the emit argument is optional everywhere it is accepted).
 */
export type EventChannel = "system" | "recon" | "probe" | "result" | "flash";

export type EmitFn = (channel: EventChannel, text: string) => void;
