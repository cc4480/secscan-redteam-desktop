/**
 * Harness2 patch-layer file headers (H2-P3, spec section 11.4).
 *
 * A section-11 layer file starts with a machine-readable comment block
 * recording the layer identity and its adoption context:
 *
 *   # harness2-layer-header
 *   # layer-id: wp-robots-hint
 *   # date: 2026-10-18
 *   # parent-layers: wp-a, wp-b | none
 *   # cycle-id: cycle-3
 *   # at-adoption deltas: vulnsFound +2, falsePositives -1 (4 base / 4 candidate runs)
 *   # status: active
 *   # harness2-layer-header-end
 *
 * The block is YAML comments, so mounting the layer never changes its meaning.
 * Consolidation stamps the merged layer at install time; any adoption path can
 * stamp its own layer by passing `applyLayerHeader(yaml, header)` as the layer
 * body to `installLayer` (the header is covered by the meta.json sha256).
 * `applyLayerHeader` is idempotent: an existing block is replaced in place, so
 * re-writing a layer's header cannot accumulate copies. The header records the
 * AT-ADOPTION state only; later transitions (rollback, guardrail incident) are
 * recorded in the archive manifest and EXPERIENCE.md, never by rewriting an
 * archived file.
 */
/** Marker line that opens the header block. */
export declare const LAYER_HEADER_BEGIN = "# harness2-layer-header";
/** Marker line that closes the header block. */
export declare const LAYER_HEADER_END = "# harness2-layer-header-end";
/** The fields of one layer header. */
export interface LayerHeader {
    /** The layer id this file was adopted as. */
    readonly layerId: string;
    /** Adoption date, YYYY-MM-DD. */
    readonly date: string;
    /** Parent layer ids the layer was derived from (empty = base-derived). */
    readonly parents: readonly string[];
    /** Cycle id. */
    readonly cycleId: string;
    /** At-adoption metric deltas, already formatted (one line). */
    readonly metricDeltas: string;
    /** Adoption-time status; "active" unless the adoption itself was exceptional. */
    readonly status: string;
}
/** Render the header comment block, including its markers. */
export declare function renderLayerHeader(header: LayerHeader): string;
/**
 * Strip a leading header block (markers included), so applying a header twice
 * replaces rather than duplicates it. Prose before the block that is not a
 * header is left alone; only the exact marker block is removed.
 */
export declare function stripLayerHeader(yaml: string): string;
/** Prepend the header to a layer YAML body, replacing an existing header. */
export declare function applyLayerHeader(yaml: string, header: LayerHeader): string;
/** Read the header fields from a layer YAML body; null when there is no header. */
export declare function readLayerHeader(yaml: string): LayerHeader | null;
/** Format the five metric deltas as one header/manifest line. */
export declare function formatMetricDeltas(deltas: Readonly<Record<"vulnsFound" | "falsePositives" | "steps" | "tokensIn" | "tokensOut", number>>, baseRuns?: number, candidateRuns?: number): string;
