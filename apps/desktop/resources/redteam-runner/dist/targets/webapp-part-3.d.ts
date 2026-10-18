/**
 * WEBAPP battery - part 3 of 7 (blocks 8-10: injection, SSRF, access control).
 * WA-053..WA-073.
 *
 * Generic client web application battery (opt-in --targets webapp). This is the
 * executable form of the SecScan (VibeScan-Enterprise-Build) and Seclayer
 * (seclayer.io2026) scan corpora: one item per attacker intent against the
 * engagement's own in-scope application.
 *
 * Evidence discipline: a hit is a finding only when the item's confirmation
 * rule is met with a receipt (a literal substring in the matched response, or
 * an OAST callback) - PROVEN. Claims that can only be observational are NEEDS
 * VERIFICATION, never CONFIRMED (SECLAYER_INVENTORY.md section 5).
 *
 * Non-destructive always: no request whose success changes customer data;
 * writes only as dry runs; DELETE only against an identifier that cannot
 * exist; no PUT; no data exfiltration.
 */
import type { TargetBatteryItem } from "./types.js";
export declare const WEBAPP_PART_3: TargetBatteryItem[];
