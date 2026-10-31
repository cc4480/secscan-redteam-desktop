import type { Harness2Paths } from "./contract.js";
import { type AdoptionRecord } from "./lifecycle-state.js";
import type { Harness2Store, RunRow } from "./store.js";
/** One class's stored runs for a monitor window, oldest first. */
export declare function windowRuns(store: Harness2Store, record: AdoptionRecord, before?: boolean): RunRow[];
/** Section-8 self-relative S and CR for a set of runs. */
export declare function metricsOf(rows: readonly RunRow[]): {
    s: number;
    cr: number;
};
/**
 * The at-adoption baseline the window is compared to: the gate candidate score
 * recorded at adoption when present, otherwise derived from the class's stored
 * runs before the adoption (S) plus their CR.
 */
export declare function baseline(store: Harness2Store, record: AdoptionRecord): {
    s: number | null;
    cr: number;
};
/**
 * Register every ACTIVE layer that has no adoption record yet, deriving the
 * baseline from its files and the store. Returns the records created.
 */
export declare function syncAdoptions(paths: Harness2Paths): AdoptionRecord[];
/** A pinned-guardrail touch (or integrity failure) in one active layer. */
export interface GuardrailTouch {
    readonly layerId: string;
    readonly kind: "guardrail-touch" | "unreadable-layer";
    readonly pinned: readonly string[];
    readonly detail: string;
}
/** Scan the ACTIVE layers for pinned-guardrail touches or failed integrity. */
export declare function guardrailTouches(paths: Harness2Paths): GuardrailTouch[];
