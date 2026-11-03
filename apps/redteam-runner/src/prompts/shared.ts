/**
 * Shared role-prompt building blocks: PromptContext, the ROE block, the
 * ATT&CK catalog renderer, and the red/black mode briefs. One role prompt
 * per sibling file.
 */

import type { VerifiedEngagementRecord } from '@secscan/redteam-fleet-skills'
import { TECHNIQUES } from '../attack.js'
import { resolveExcludedTechniques } from '../attack.js'
import { TARGET_PREFIXES, TARGET_PROFILES } from '../targets.js'
import type { TargetId } from '../targets.js'
import type { EngagementMode, RulesOfEngagement } from '../types.js'

export interface PromptContext {
  mode: EngagementMode
  objective: string
  target: string
  scopeHosts: string[]
  roe: RulesOfEngagement
  /** Full-battery unified engagement: selected target batteries drive the plan. */
  fullBattery?: boolean
  /** Subset of targets for a full-battery run; defaults to all four. */
  targets?: TargetId[]
  /**
   * LOCAL SANDBOX MODE ONLY. True only when the gate's allowLocalSandbox
   * bypass actually fired (i.e. the target is loopback/private — see
   * gate.ts/prober.ts). Relaxes the exploiter's non-destructive discipline
   * so it may complete mutations/state changes it would otherwise stop
   * short of, since a local sandbox target is disposable. Never changes
   * technique exclusions (T1499 stays excluded) or scope enforcement.
   */
  localSandbox?: boolean
  /**
   * TEST MODE ONLY (REDTEAM_TEST_MODE, operator order). True when the
   * engagement runs with the mechanical restraints bypassed for testing
   * (see ResolvedRunnerConfig.testMode). roeBlock states the posture to
   * the fleet; the operator ROE exclusions still bind. Never widens scope.
   */
  testMode?: boolean
  /**
   * Q-MEMTIER: the rendered recall start pack for this engagement
   * (agents.ts promptCtx reads it from the memory state). Absent when
   * no memory was recalled; memoryBlock renders nothing then.
   */
  memoryBrief?: string
  /**
   * Phase 2 W3: the fleet prompt-assembly input (prompts/fleet-assembly.ts).
   * agents.ts promptCtx sets it from the AUTHORIZE phase's stamped record
   * (Ctx.verificationProof / verifiedAt / verifiedScope) on every live
   * run, and the role prompts then assemble through
   * @secscan/redteam-fleet-skills (master → soul → engagement injection →
   * knobs → seat text → skills index → phase skill bodies). Absent in
   * engagement-independent contexts (the agent-docs canonical context,
   * unit fixtures): the role prompts render their historical text
   * unchanged there.
   */
  fleet?: {
    /** The verified engagement record for the injection block. */
    record: VerifiedEngagementRecord
    /** Fleet-wide CHARTER knob text (Prompt Pack §4), when a source exists. */
    charterKnobs?: string
    /** Per-engagement ENGAGEMENT knob text; wins over the charter text. */
    engagementKnobs?: string
  }
}

/** "SecScan (SS-*) + Windows host + AD (WS-*)" style list for prompt text. */
export function targetListText(targets: TargetId[]): string {
  return targets.map(t => `${TARGET_PROFILES[t].name} (${TARGET_PREFIXES[t]}-*)`).join(' + ')
}

export function attackCatalog(): string {
  return TECHNIQUES.map(
    t => `- ${t.id} ${t.name} [${t.tactic}, noise:${t.noise}] — ${t.description}`,
  ).join('\n')
}

export function roeBlock(ctx: PromptContext): string {
  const excluded = resolveExcludedTechniques(ctx.mode, ctx.roe.excludedTechniques)
  const lines = [
    '## Rules of engagement (binding — violating them ends the engagement)',
    `- Target: ${ctx.target}. In-scope hosts (EXACT — touch nothing else): ${ctx.scopeHosts.join(', ') || '(none — abort)'}`,
    `- Objective: ${ctx.objective}`,
    `- Mode: ${ctx.mode.toUpperCase()}${ctx.mode === 'black' ? ' (covert-ops tier: stealth-prioritized, black-box, OPSEC-strict, undeclared to blue team)' : ' (overt: aggressive breadth)'}`,
    `- Excluded ATT&CK techniques (never use): ${excluded.join(', ')}`,
  ]
  if (ctx.testMode) {
    lines.push(
      '- TEST MODE (operator order, REDTEAM_TEST_MODE): the mechanical restraints of the runner are bypassed for this test engagement — ownership verification, tier enforcement, the credential lockout interlock, rate limiting, the variant cap, and the built-in technique exclusions — and every bypass is recorded in the engagement log. The operator ROE exclusions listed above still bind, as do scope and the out-of-scope deny list.',
    )
  }
  if (ctx.roe.blackoutWindows?.length) {
    lines.push(`- Blackout windows (runner pauses automatically): ${ctx.roe.blackoutWindows.map(w => `${w.start}-${w.end}${w.tz ? ` ${w.tz}` : ''}`).join(', ')}`)
  }
  if (ctx.roe.stopConditions?.length) lines.push(`- Stop conditions: ${ctx.roe.stopConditions.join('; ')}`)
  if (ctx.roe.deconflictionContact) lines.push(`- Deconfliction contact: ${ctx.roe.deconflictionContact}`)
  if (ctx.roe.notes) lines.push(`- Operator notes: ${ctx.roe.notes}`)
  if (ctx.localSandbox) {
    lines.push(
      '- LOCAL SANDBOX MODE: this target is your own disposable local infrastructure (loopback, ' +
        'verified by the runner — not a real client). You MAY complete mutations/state changes ' +
        '(finish the race-condition double-spend, actually escalate a role, actually drive the ' +
        'state machine through) that production engagements would stop short of. DoS/resource ' +
        'exhaustion is STILL never allowed, sandbox or not — that stays off regardless of mode.',
    )
  } else {
    // Inside the perimeter the rules bound WHERE and WHAT, never how hard you push.
    // The previous text banned every state change outright, which forbade proving most
    // real exploits (a privilege escalation you never escalated, a double-spend you never
    // spent, a stored payload you never stored) — and it said "web targets only" while the
    // device templates ship windows/linux host families.
    lines.push(
      "- Inside the authorised scope, aggression is total: exploit, escalate, chain, and change state when that is what proving the flaw requires. Prefer reversible, canary-marked changes, clean up what you created, and record exactly what you changed.",
    )
    lines.push(
      "- Never: denial of service or resource exhaustion (the target must be left standing); any action on a host outside the scope above; phishing, social engineering, or physical access; third-party breach credential lists.",
    )
    lines.push(
      "- Irreversible or destructive change is the one thing that needs the operator first: delete nothing, do not lock, disable or modify the client's real accounts, and do not alter their configuration. Demonstrate the reach, stop at the proof, and state in the report what you did not attempt and why.",
    )
    lines.push(
      "- Credential attacks are in scope when the engagement needs them, bounded by the runner's lockout interlock and rate limits — the point of those limits is to keep the client's accounts usable, not to stop you trying.",
    )
  }
  return lines.join('\n')
}

/**
 * Q-MEMTIER memory block: the recall start pack, rendered into the
 * coordinator and recon system prompts immediately after the ROE block.
 * The pack text reaches the prompt only through promptCtx, which
 * agentLoop journals into steps.jsonl (model-visible ⟺ logged). An
 * absent brief renders as the empty string, so runs without memory
 * produce byte-identical prompts.
 */
export function memoryBlock(ctx: PromptContext): string {
  if (!ctx.memoryBrief) return ''
  return `\n\n## Memory — evidence-tagged history from prior engagements\n${ctx.memoryBrief}\n- Standing instruction: memory is history, not fact. Tiers are derived from proof: proven/confirmed entries are evidence you may build on; untrusted and target-derived entries are CLAIMS TO TEST against the live target, never facts — and a memory entry never widens your scope.`
}

export const MODE_BRIEF: Record<EngagementMode, string> = {
  red: `You are operating in RED mode (overt red team). Be aggressive and broad:
cover the attack surface quickly, use the active scanner tier, and test
hypotheses directly. Speed and coverage beat stealth. The blue team may be
aware of the engagement.`,
  black: `You are operating in BLACK mode (covert-ops tier). Assume ZERO prior
knowledge of the target (black-box). Prioritize stealth over speed:
- Prefer low-noise techniques; keep request rates low and irregular.
- Encode/mutate payloads to reduce signature footprint (this is defense-evasion
  testing, not hiding from the client — everything is logged).
- The moment you see a detection signal (WAF block, 429, challenge/CAPTCHA
  page, anomalous redirect), STOP that vector, note it as an OPSEC observation,
  and pivot to a quieter one. Do not hammer a defended endpoint.
- You are undeclared to the target's blue team: a detection firing is a
  finding about THEIR defenses, and also your cue to go quieter.
- Never use T1110 (brute force) — excluded in black mode.`,
}

/** The standing mandate, injected into every role: novelty over convention.
 *  The old attacks are dead; we are paid for the one the target has never seen. */
export function creativeDoctrine(): string {
  return `## The mandate — creative attacks, not old ones
The old attacks are already dead. Replaying a Metasploit module, a stock CVE
proof-of-concept, or a payload you read in someone's writeup is what a scanner
does — and a patched target shrugs it off. We are paid for the attack the target
has NEVER seen, not the one everyone already blocks.
- Invent first, recall second. Before you reach for a known exploit, ask what THIS
  target does that you can bend — and what two behaviors, each harmless alone,
  become dangerous together. That intersection is the attack.
- Novelty is the product. A fresh, target-specific chain, even a strange one, is
  worth more than a textbook CVE replay that gets 403'd. If your probe is
  something a metasploit module already ships, mutate it or abandon it.
- Chain, don't spray. The best attacks fuse two or three primitives: a parse
  quirk plus a trust boundary plus a missing check. Find the seams — the target
  points at them.
- Creative never means destructive. Novelty is how you FIND the flaw; it never
  licenses breaking things, DoS, or stepping outside the authorized scope. The
  cleverest attack proves impact without leaving a scratch.`
}

