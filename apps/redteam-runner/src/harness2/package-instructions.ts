/**
 * Harness2 proposal-package instructions block (H2-P2a).
 *
 * The markdown the frontier editor reads before proposing: the eight components,
 * which are EDITABLE, the PINNED guardrails and the auto-reject/flag rule, the
 * required output format (one cordis patch-layer YAML + a rationale), the
 * constraints (no new model APIs, no destructive actions, additive layers only,
 * no new dependencies), the token budget warning, the documented component path
 * map, the EXPERIENCE.md format, and the per-package selection notes.
 */
import { EDITABLE_COMPONENTS, HARNESS_COMPONENTS, PINNED_COMPONENT } from "./contract.js";
import { COMPONENT_FILE_MAP } from "./package-component-map.js";
import { EXPERIENCE_FORMAT_DOC } from "./package-experience.js";

function componentMapLines(): string[] {
  return EDITABLE_COMPONENTS.map((component) => {
    const sources = COMPONENT_FILE_MAP[component] ?? [];
    const described = sources.length === 0 ? "(not present in this payload)" : sources.map((source) => `${source.path} (${source.kind})`).join(", ");
    return `- ${component}: ${described}`;
  });
}

/** Build the instructions block; `notes` are the pair-selection notes. */
export function buildInstructions(notes: readonly string[], sourceBytes: number): string {
  const kib = Math.max(1, Math.round(sourceBytes / 1024));
  return [
    "You are editing the harness of an autonomous red-team runner. You receive contrasted runs of the SAME target class (a high-yield positive and a low/zero-yield negative), the current sources of every editable harness component, the class's lessons, and aggregate metrics.",
    "",
    "## The eight harness components",
    `All eight: ${Object.values(HARNESS_COMPONENTS).join(", ")}.`,
    `EDITABLE (you may propose a layer for these only): ${EDITABLE_COMPONENTS.join(", ")}.`,
    `PINNED: ${PINNED_COMPONENT}, implemented by src/safety, src/policy and auth-gate. Guardrails are NEVER editable. ANY proposal whose YAML touches src/safety, src/policy or auth-gate is AUTO-REJECTED and FLAGGED, and the rejection is recorded against your answer. Do not propose, reference or re-implement them.`,
    "",
    "## Required output format",
    "Return exactly two parts:",
    "1. ONE fenced ```yaml block holding a single cordis patch-layer document (the `- insert:` list shape used by cordis.patch.yml), which must begin with a header naming the component and the target class:",
    "   # component: <one editable component id>",
    "   # target-class: <the package target class>",
    "2. A short rationale in prose OUTSIDE the YAML fence: which contrast pair you used, what you changed, and the metric you expect to move (vulnsFound first; steps/tokens second).",
    "",
    "## Constraints",
    "- Additive layers only: never rewrite or delete the base layer; insert new entries on top of it.",
    "- No new model APIs: do not mount providers, change model routing, or add network calls.",
    "- No destructive actions: nothing that deletes files, data, findings or engagements.",
    "- No new dependencies.",
    "- Never touch the pinned guardrails: such proposals are rejected and flagged automatically.",
    "",
    "## Token budget",
    `The component sources below are ${kib} KiB verbatim. Read them once, reason across the pairs, and emit a small additive layer (roughly 20-60 lines). A giant rewrite will be rejected on review.`,
    "",
    "## Component file map (repo-relative)",
    ...componentMapLines(),
    "",
    "## EXPERIENCE.md format (lessons already learned for this class)",
    EXPERIENCE_FORMAT_DOC,
    "",
    "## Selection notes",
    ...(notes.length === 0 ? ["(all class runs were comparable and layer-matched)"] : notes.map((note) => `- ${note}`)),
  ].join("\n");
}
