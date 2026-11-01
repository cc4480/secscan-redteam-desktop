import type { VerifiedEngagementRecord } from './types.js';
import { buildEngagementInjection } from './engagement.js';
import { KNOWN_KNOBS } from './knobs.js';

/**
 * Fleet prompt assembly. The ORDER of the blocks is the contract:
 *
 *   master → soul → verified engagement injection → knobs → seat delta →
 *   skills index → skill bodies
 *
 * The master establishes identity and rules; the soul (the seat's character
 * file, prompts/souls/*.md) gives the seat its persona and drive — persona
 * is presentation, never an override of the master's rules. The injection
 * (system-level, harness-generated from the verified record) pre-classifies
 * the work before the seat delta narrows the role and the skills supply
 * the how.
 * Never reorder, and never assemble without a record — buildEngagement-
 * Injection throws on an incomplete one (no record, no prompt).
 */

export interface AssembleFleetPromptOptions {
  master: string;
  /** The seat's SOUL.md character text (optional). Inserted after the
   *  master and before the engagement injection when present. */
  soul?: string;
  seatDelta?: string;
  record: VerifiedEngagementRecord;
  knobs?: { values: Record<string, string> };
  skillIndex?: string;
  skillBodies?: { name: string; body: string }[];
}

function renderKnobsBlock(values: Record<string, string>): string {
  const lines = Object.entries(values).map(([k, v]) => `${k} = ${v}`);
  return ['<knobs>', ...lines, '</knobs>'].join('\n');
}

function sanitizeAttrValue(s: string): string {
  return s.replace(/["<>\r\n]/g, '').trim();
}

/**
 * Assemble a complete fleet system prompt from its blocks, in the fixed
 * order documented at the top of this module.
 *
 * @param opts - the master text, verified record, and optional soul, seat,
 *   knob, index, and skill-body blocks.
 * @returns the assembled prompt text.
 */
export function assembleFleetPrompt(opts: AssembleFleetPromptOptions): string {
  if (typeof opts.master !== 'string' || opts.master.trim() === '') {
    throw new Error('assembleFleetPrompt: master prompt text is required.');
  }

  const parts: string[] = [];

  parts.push(opts.master.trim());

  if (opts.soul !== undefined && opts.soul.trim() !== '') {
    parts.push(opts.soul.trim());
  }

  // Throws on an incomplete record — fail loud by design.
  parts.push(buildEngagementInjection(opts.record));

  const knobValues = opts.knobs?.values ?? { ...KNOWN_KNOBS };
  parts.push(renderKnobsBlock(knobValues));

  if (opts.seatDelta !== undefined && opts.seatDelta.trim() !== '') {
    parts.push(opts.seatDelta.trim());
  }

  if (opts.skillIndex !== undefined && opts.skillIndex.trim() !== '') {
    const index = opts.skillIndex.trim();
    parts.push(
      index.includes('<fleet_skills_index>')
        ? index
        : `<fleet_skills_index>\n${index}\n</fleet_skills_index>`,
    );
  }

  for (const skill of opts.skillBodies ?? []) {
    const name = sanitizeAttrValue(skill.name);
    if (name === '') continue;
    parts.push(
      `<skill_content name="${name}">\n${skill.body.trim()}\n</skill_content>`,
    );
  }

  return parts.join('\n\n');
}
