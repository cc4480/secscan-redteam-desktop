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
export const LAYER_HEADER_BEGIN = "# harness2-layer-header";
/** Marker line that closes the header block. */
export const LAYER_HEADER_END = "# harness2-layer-header-end";

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

/** Collapse a value to one ASCII-safe line; header values are never multi-line. */
function oneLine(value: string): string {
  return value.replace(/\s*\r?\n\s*/g, " ").trim();
}

/** The `parents` field value ("none" when the layer derives from the base). */
function parentField(parents: readonly string[]): string {
  return parents.length === 0 ? "none" : [...parents].join(", ");
}

/** Render the header comment block, including its markers. */
export function renderLayerHeader(header: LayerHeader): string {
  return [
    LAYER_HEADER_BEGIN,
    `# layer-id: ${oneLine(header.layerId)}`,
    `# date: ${oneLine(header.date)}`,
    `# parent-layers: ${parentField(header.parents)}`,
    `# cycle-id: ${oneLine(header.cycleId)}`,
    `# at-adoption deltas: ${oneLine(header.metricDeltas)}`,
    `# status: ${oneLine(header.status)}`,
    LAYER_HEADER_END,
    "",
  ].join("\n");
}

/**
 * Strip a leading header block (markers included), so applying a header twice
 * replaces rather than duplicates it. Prose before the block that is not a
 * header is left alone; only the exact marker block is removed.
 */
export function stripLayerHeader(yaml: string): string {
  const lines = yaml.split(/\r?\n/);
  if (lines[0] === undefined || lines[0].trim() !== LAYER_HEADER_BEGIN) return yaml;
  for (let index = 1; index < lines.length; index++) {
    if (lines[index]!.trim() === LAYER_HEADER_END) {
      // Drop the block and one following blank separator line, when present.
      const rest = lines.slice(index + 1);
      if (rest[0] === "") rest.shift();
      return rest.join("\n");
    }
  }
  return yaml; // unterminated block: leave the body untouched
}

/** Prepend the header to a layer YAML body, replacing an existing header. */
export function applyLayerHeader(yaml: string, header: LayerHeader): string {
  const body = stripLayerHeader(yaml).replace(/^\r?\n+/, "");
  return renderLayerHeader(header) + body;
}

/** Read the header fields from a layer YAML body; null when there is no header. */
export function readLayerHeader(yaml: string): LayerHeader | null {
  const lines = yaml.split(/\r?\n/);
  if (lines[0] === undefined || lines[0].trim() !== LAYER_HEADER_BEGIN) return null;
  const fields = new Map<string, string>();
  let closed = false;
  for (let index = 1; index < lines.length; index++) {
    const line = lines[index]!;
    if (line.trim() === LAYER_HEADER_END) {
      closed = true;
      break;
    }
    const match = /^#\s*([a-z][a-z -]*?)\s*:\s*(.*?)\s*$/i.exec(line);
    if (match !== null && !fields.has(match[1]!.toLowerCase())) fields.set(match[1]!.toLowerCase(), match[2] ?? "");
  }
  if (!closed) return null;
  const layerId = fields.get("layer-id");
  const date = fields.get("date");
  if (layerId === undefined || layerId === "" || date === undefined || date === "") return null;
  const parents = (fields.get("parent-layers") ?? "").split(",").map((id) => id.trim()).filter((id) => id !== "" && id.toLowerCase() !== "none");
  return {
    layerId,
    date,
    parents,
    cycleId: fields.get("cycle-id") ?? "",
    metricDeltas: fields.get("at-adoption deltas") ?? "",
    status: fields.get("status") ?? "",
  };
}

/** Format the five metric deltas as one header/manifest line. */
export function formatMetricDeltas(
  deltas: Readonly<Record<"vulnsFound" | "falsePositives" | "steps" | "tokensIn" | "tokensOut", number>>,
  baseRuns?: number,
  candidateRuns?: number,
): string {
  const keys = ["vulnsFound", "falsePositives", "steps", "tokensIn", "tokensOut"] as const;
  const body = keys.map((key) => `${key} ${deltas[key] >= 0 ? "+" : ""}${deltas[key]}`).join(", ");
  const runs = baseRuns === undefined || candidateRuns === undefined ? "" : ` (${baseRuns} base / ${candidateRuns} candidate runs)`;
  return `${body}${runs}`;
}
