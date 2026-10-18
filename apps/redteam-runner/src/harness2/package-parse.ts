/**
 * Harness2 pasted-back answer parser + guardrail auto-reject (H2-P2a).
 *
 * The frontier editor answers a package with ONE fenced cordis patch-layer YAML
 * plus a rationale. parseProposalResponse extracts both into a contract.Proposal
 * and is the security boundary: if the YAML touches a pinned guardrail path
 * (src/safety, src/policy, auth-gate, or the guardrail component) the answer is
 * rejected with `flagged = true` and the matched pinned labels, so the caller
 * records the event and never applies the layer. Separator/case variants
 * (SRC\SAFETY) are normalized before matching.
 */
import { createHash } from "node:crypto";
import { EDITABLE_COMPONENTS, HARNESS_COMPONENTS, PINNED_COMPONENT } from "./contract.js";
import type { HarnessComponentId, Proposal, TargetClass } from "./contract.js";
import { COMPONENT_FILE_MAP, findPinnedTouch } from "./package-component-map.js";

/** A rejected editor answer. `flagged` marks a pinned-guardrail violation. */
export class ProposalParseError extends Error {
  /** True when the answer touched a pinned guardrail (security event, not a typo). */
  readonly flagged: boolean;
  /** Pinned path labels the answer touched; empty for a plain parse error. */
  readonly pinnedPaths: readonly string[];

  constructor(message: string, flagged = false, pinnedPaths: readonly string[] = []) {
    super(`proposal rejected: ${message}`);
    this.name = "ProposalParseError";
    this.flagged = flagged;
    this.pinnedPaths = pinnedPaths;
  }
}

const YAML_BLOCK = /```ya?ml[^\n]*\r?\n([\s\S]*?)```/i;
const COMPONENT_HEADER = /^#\s*component:\s*([a-z][a-z0-9-]*)\s*$/im;
const TARGET_CLASS_HEADER = /^#\s*target-class:\s*([^\s#]+)\s*$/im;

export interface ParseProposalContext {
  /** Target class the package was built for; wins over the YAML header. */
  readonly targetClass?: TargetClass;
  /** Explicit proposal id; defaults to a content hash, so it is reproducible. */
  readonly id?: string;
}

function inferComponent(yaml: string, header: string | undefined): HarnessComponentId {
  const editable: readonly string[] = EDITABLE_COMPONENTS;
  if (header !== undefined && editable.includes(header)) return header as HarnessComponentId;
  const normalized = yaml.toLowerCase().replace(/\\/g, "/");
  for (const component of EDITABLE_COMPONENTS) {
    if ((COMPONENT_FILE_MAP[component] ?? []).some((source) => normalized.includes(source.path.toLowerCase()))) return component;
  }
  return HARNESS_COMPONENTS.plugins;
}

/**
 * Parse the editor's pasted-back answer into a Proposal. Missing/malformed YAML
 * throws ProposalParseError; a YAML block touching a pinned guardrail path
 * throws the same class with flagged=true, so the caller records the security
 * event and never applies the layer.
 */
export function parseProposalResponse(text: string, context: ParseProposalContext = {}): Proposal {
  if (typeof text !== "string" || text.trim() === "") throw new ProposalParseError("the answer was empty");
  const block = YAML_BLOCK.exec(text);
  const yaml = (block?.[1] ?? "").trim();
  if (yaml === "") {
    throw new ProposalParseError("missing a fenced ```yaml ... ``` block; the instructions require exactly one cordis patch-layer YAML");
  }
  const header = COMPONENT_HEADER.exec(yaml)?.[1]?.trim().toLowerCase();
  const pinned = [...findPinnedTouch(yaml)];
  if (header === PINNED_COMPONENT) pinned.push(PINNED_COMPONENT);
  if (pinned.length > 0) {
    throw new ProposalParseError(
      `the YAML touches PINNED guardrail component ${[...new Set(pinned)].join(", ")}; guardrails (src/safety, src/policy, auth-gate) are never editable`,
      true,
      [...new Set(pinned)],
    );
  }
  if (block === null) throw new ProposalParseError("missing a fenced ```yaml ... ``` block");
  const rationale = `${text.slice(0, block.index)}${text.slice(block.index + block[0].length)}`.trim();
  const targetClass = context.targetClass ?? TARGET_CLASS_HEADER.exec(yaml)?.[1] ?? "unknown";
  const id = context.id ?? `prop-${createHash("sha256").update(yaml).digest("hex").slice(0, 12)}`;
  return { id, targetClass, component: inferComponent(yaml, header), yaml, rationale };
}
