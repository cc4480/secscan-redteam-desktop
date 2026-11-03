/**
 * Attested-host check — the allowance the tool-internal target guards
 * (the web prober, the SecScan engine's target guard) consult before
 * refusing a private/loopback target.
 *
 * The dispatch scope gate already decides target scope from the
 * AUTHORIZE phase's attested record (ctx.verifiedScope, via
 * scopeGuardFor). The tools' own egress guards historically keyed
 * private-target allowance on config flags alone (the local-sandbox
 * opt-in), so an attested private target — a lab host, a LAN machine
 * the owner verified — passed dispatch and then died inside the tool:
 * eng-2026-11-02-or12 confirmed 0/9 because http_probe and
 * secscan_exec both refused the attested 127.0.0.1. This check closes
 * that gap from the same record, never a parallel one: a host is
 * allowance-eligible only when a verified record exists AND the
 * engagement's scope guard, built from that record, allows the host
 * (the deny list included — deny beats allow). No record, no
 * allowance: a context authorize has not stamped keeps exactly the
 * refusal behavior the guards have always had, and an empty record
 * can never open a private target.
 */
import { scopeGuardFor } from "./scope-guard.js";
/** The context fields the check reads — scopeGuardFor's own inputs. */
type AttestedHostCtx = Parameters<typeof scopeGuardFor>[0];
/**
 * Whether `host` is covered by the engagement's verified record.
 *
 * @param ctx - The engagement context (or context-shaped object).
 * @param host - The target host or IP (hostname form; no scheme/port).
 * @returns True only when a verified record exists and its scope
 *   guard allows the host; false in every other case (fail closed).
 */
export declare function attestedHostAllowed(ctx: AttestedHostCtx, host: string): boolean;
export {};
