/**
 * Derived activity section for the engagement report (v0.33.0).
 *
 * Everything here is *projected* from the event stream — it is runner-computed
 * record, never model narrative. It gives the report three things it could not
 * state before:
 *   - what was actually executed, per action, with ATT&CK mapping and seq range
 *   - the operator-decision timeline (sign-off / escalation / abort)
 *   - a mechanical causality-integrity check over `causedBy` links
 */
import type { EngagementEvent } from "../types.js";
/** Render the tool-activity / decisions / causality section, or "" for an empty log. */
export declare function buildActivitySection(events: EngagementEvent[]): string;
