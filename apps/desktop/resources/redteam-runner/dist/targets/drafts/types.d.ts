/**
 * Local types for parked battery-family drafts.
 *
 * A draft must not widen the shipped registry until the wiring pass is done, so
 * it describes itself with these shapes rather than importing `TargetId` /
 * `TargetKind` from the live registry (which the drafts are not part of yet).
 */
import type { BatteryCategory } from "../../battery.js";
export interface DraftBatteryItem {
    id: string;
    category: BatteryCategory;
    name: string;
    brief: string;
    owasp: string;
    attackId?: string;
    what: string;
}
export interface DraftTargetProfile {
    id: string;
    name: string;
    baseUrl: string;
    kind: string;
    authModel: string;
    scopeNotes: string;
    battery: DraftBatteryItem[];
}
