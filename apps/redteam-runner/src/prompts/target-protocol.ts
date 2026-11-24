/**
 * Target-family protocols (the "no headless chicken" layer).
 *
 * Every engagement binds to exactly ONE target family before any seat acts.
 * The family decides, mechanically:
 *
 *   - what the recon seat enumerates first (platform, not pages),
 *   - which skills ride in each seat's prompt (a Windows host gets AD/SMB/
 *     WinRM tooling, never webapp-scan; an Android app gets mobile static and
 *     dynamic analysis, never nmap-first),
 *   - which ordered steps exist, who owns each, what each step must collect,
 *     and what evidence closes it,
 *   - what the seat may NOT do on that family.
 *
 * A seat acts inside the CURRENT step only. A tool outside the step's allowlist
 * needs a recorded rationale naming the step it serves; an unmapped family runs
 * the DETECTION step before anything else. A step with no applicable surface is
 * closed with a recorded verdict carrying the observation that proves it — never
 * silently skipped and never marked clean.
 */

import type { FleetSeatRole } from './fleet-seats.js'
import { WEBAPP, WINDOWS } from './target-protocol-families-a.js'
import { ANDROID, IOS, LINUX, NETWORK } from './target-protocol-families-b.js'

/** The target families an engagement can bind to. */
export type TargetFamily = 'webapp' | 'windows' | 'linux' | 'android' | 'ios' | 'network'

/** One ordered step of a family's protocol. */
export interface ProtocolStep {
  /** Stable step id cited in action rationale and evidence (`WIN-03`). */
  id: string
  /** What this step establishes. */
  title: string
  /** The seat that owns the step. One step, one owner. */
  owner: FleetSeatRole
  /** Tools the owner may use for this step. Anything else needs a rationale. */
  tools: readonly string[]
  /** What must be collected while the step runs. */
  collect: readonly string[]
  /** The observable condition that closes the step. */
  done: string
  /** The artifact that proves the step ran. */
  evidence: string
}

/** A family's complete protocol: intelligence, ordered steps, guardrails. */
export interface TargetProtocol {
  family: TargetFamily
  label: string
  /** Evidence gathered BEFORE any active action, to place the family. */
  intelligence: readonly string[]
  /** How the family is confirmed on this target. */
  confirm: string
  /** Ordered steps. Order is the plan; skipping forward needs a reason on record. */
  steps: readonly ProtocolStep[]
  /** Actions that are wrong for this family regardless of ROE. */
  forbidden: readonly string[]
  /**
   * The task each seat owns in this family. No seat is left undefined: a seat
   * that owns no step still has a standing duty here, and it is written down.
   */
  seatTasks: Readonly<Record<FleetSeatRole, string>>
  /** Layer-2 skills bound per seat for this family. */
  skills: Readonly<Record<FleetSeatRole, readonly string[]>>
}

/** Law every seat carries, whatever the family. */
export const PROTOCOL_LAW = [
  'One engagement, one target family. Bind the family before the first action.',
  'Act inside the current step only. Cite its step id (e.g. WIN-03) in the action rationale.',
  'A tool outside the current step\'s allowlist requires a recorded rationale naming the step it serves.',
  'A step with no applicable surface is closed with a recorded verdict + the observation proving it. Never silent, never "clean".',
  'Non-destructive always: no writes, no deletes, no account or credential modification, no DoS, no exfiltration beyond proof.',
  'Two independent observations before any finding. One observation is a lead, not a finding.',
].join('\n')

const BASE_PROTOCOLS: Readonly<Record<TargetFamily, TargetProtocol>> = {
  webapp: WEBAPP,
  windows: WINDOWS,
  linux: LINUX,
  android: ANDROID,
  ios: IOS,
  network: NETWORK,
}

/** One of the steps every family ends with (A5). */
interface SharedStepBlueprint {
  title: string
  owner: FleetSeatRole
  tools: readonly string[]
  collect: readonly string[]
  done: string
  evidence: string
}

/**
 * The three steps every family ends with (A5). The seat audit found coder,
 * evaluator-reporter and publisher owning ZERO steps across all six families,
 * which made "has tools" true and "has a job in the plan" false. These are
 * their jobs, in the same shape as every other step: owner, tools, what to
 * collect, done-criteria, evidence.
 */
const SHARED_TAIL: readonly SharedStepBlueprint[] = [
  {
    title: 'Build the helper the proving step needs',
    owner: 'coder',
    tools: ['pc_run', 'load_skill'],
    collect: [
      'what the proving step needs that the offered tools cannot do',
      'the built artifact, where it lives, and how it is invoked',
    ],
    done: 'The helper exists, runs on the analysis host, and is cited by the step that uses it.',
    evidence: 'helper path + the local run that proves it works',
  },
  {
    title: 'Evaluate proofs and gate the report',
    owner: 'reporter',
    tools: ['record_finding', 'record_item_verdict'],
    collect: [
      "every finding's two independent observations",
      'the negative control for each finding',
      'every killed hypothesis and its killing observation',
    ],
    done: 'Every finding carries two observations plus a negative control, or is downgraded to DETECTED.',
    evidence: 'finding records with receipts; verdict ledger complete',
  },
  {
    title: 'Assemble the uniform report set',
    owner: 'publisher',
    tools: [],
    collect: [
      'the fixed manifest from the house template',
      'findings grouped into key risk areas with ranked actions',
    ],
    done: 'Exactly one .md, one .txt, one .csv and one HTML from the house template exist, same names every run.',
    evidence: 'file-set listing from the engagement report directory',
  },
]

/**
 * Append the shared seat steps, numbered into the family's own sequence.
 * @param protocol - the family's protocol before the shared tail.
 * @returns the protocol with the three shared steps appended.
 */
function withSharedTail(protocol: TargetProtocol): TargetProtocol {
  const first = protocol.steps[0]
  if (first === undefined) throw new Error('target-protocol: a family protocol has no steps')
  const [prefix = first.id] = first.id.split('-')
  const start = protocol.steps.length + 1
  const extra: ProtocolStep[] = SHARED_TAIL.map((blueprint, index) => ({
    id: `${prefix}-${String(start + index).padStart(2, '0')}`,
    title: blueprint.title,
    owner: blueprint.owner,
    tools: blueprint.tools,
    collect: blueprint.collect,
    done: blueprint.done,
    evidence: blueprint.evidence,
  }))
  return { ...protocol, steps: [...protocol.steps, ...extra] }
}

/** Every protocol, by family — the family's own steps, then the shared three. */
export const TARGET_PROTOCOLS: Readonly<Record<TargetFamily, TargetProtocol>> =
  Object.fromEntries(
    (Object.entries(BASE_PROTOCOLS) as [TargetFamily, TargetProtocol][])
      .map(([family, protocol]) => [family, withSharedTail(protocol)]),
  ) as Record<TargetFamily, TargetProtocol>

/** The result of binding a target to a family. */
export interface FamilyBinding {
  family: TargetFamily
  /** Why this family was chosen. */
  reason: string
  /** declared = operator named it; inferred = derived from the target; default = discovery-first. */
  confidence: 'declared' | 'inferred' | 'default'
}

/** Declared engagement family names → protocol family. */
const DECLARED_FAMILIES: Readonly<Record<string, TargetFamily>> = {
  webapp: 'webapp',
  web: 'webapp',
  api: 'webapp',
  secscan: 'webapp',
  seclayer: 'webapp',
  windows: 'windows',
  linux: 'linux',
  android: 'android',
  ios: 'ios',
  network: 'network',
}

/**
 * Bind a target to exactly one family BEFORE any seat acts.
 *
 * Order: the operator's declared family wins (it is the engagement's own
 * statement); otherwise the target's shape infers it; otherwise the engagement
 * binds `network` and the protocol's first act is classification. An
 * unrecognized declared value never silently becomes another family.
 *
 * @param input - the engagement target and any declared target families.
 * @returns the binding, with the reason recorded for the board.
 */
export function bindTargetFamily(input: {
  target: string
  declared?: readonly string[]
}): FamilyBinding {
  const declared = (input.declared ?? [])
    .map(value => value.trim().toLowerCase())
    .filter(value => value !== '')
  for (const value of declared) {
    const family = DECLARED_FAMILIES[value]
    if (family !== undefined) {
      return { family, reason: `operator declared target family "${value}"`, confidence: 'declared' }
    }
  }
  const target = input.target.trim().toLowerCase()
  if (target === '') {
    return { family: 'network', reason: 'no target shape to bind; discovery-first', confidence: 'default' }
  }
  if (target.endsWith('.apk') || target.endsWith('.aab') || target.includes('android')) {
    return { family: 'android', reason: 'target names an Android artifact', confidence: 'inferred' }
  }
  if (target.endsWith('.ipa') || target.includes('ios')) {
    return { family: 'ios', reason: 'target names an iOS artifact', confidence: 'inferred' }
  }
  if (/^https?:\/\//.test(target) || target.includes('/')) {
    return { family: 'webapp', reason: 'target is an HTTP URL', confidence: 'inferred' }
  }
  if (/:(445|139|3389|5985|5986|88|389)\b/.test(target)) {
    return { family: 'windows', reason: 'target names a Windows service port', confidence: 'inferred' }
  }
  if (/:(22|2049)\b/.test(target)) {
    return { family: 'linux', reason: 'target names an SSH/NFS port', confidence: 'inferred' }
  }
  return { family: 'network', reason: 'host without a decisive service hint; discovery-first', confidence: 'default' }
}

/**
 * The skills one seat binds for a family.
 * @param role - the fleet seat.
 * @param family - the bound family.
 * @returns the skill names to bind (Layer-2 bodies).
 */
export function skillsForRole(role: FleetSeatRole, family: TargetFamily): readonly string[] {
  return TARGET_PROTOCOLS[family].skills[role]
}

/**
 * Render the protocol as the prompt block every seat carries.
 * @param binding - the family binding to render.
 * @returns markdown block: law, family, ordered steps with owner/tools/exit.
 */
export function protocolPromptBlock(binding: FamilyBinding): string {
  const protocol = TARGET_PROTOCOLS[binding.family]
  const lines: string[] = [
    `## TARGET PROTOCOL — ${protocol.label} (family: ${protocol.family})`,
    '',
    `Bound because: ${binding.reason} (${binding.confidence}).`,
    `Confirm on target: ${protocol.confirm}`,
    '',
    '### Protocol law',
    '```text',
    PROTOCOL_LAW,
    '```',
    '',
    '### Intelligence to establish first',
    ...protocol.intelligence.map(item => `- ${item}`),
    '',
    '### Ordered steps — act inside the current one only',
  ]
  for (const step of protocol.steps) {
    lines.push(
      '',
      `#### ${step.id} — ${step.title}`,
      `- Owner: \`${step.owner}\``,
      `- Tools: ${step.tools.length > 0 ? step.tools.map(tool => `\`${tool}\``).join(', ') : '_none — decision step_'}`,
      `- Collect: ${step.collect.join('; ')}`,
      `- Closes when: ${step.done}`,
      `- Evidence: ${step.evidence}`,
    )
  }
  lines.push(
    '',
    '### Assigned task per seat — no seat is undefined',
    ...Object.entries(protocol.seatTasks).map(([seat, task]) => `- **${seat}** — ${task}`),
    '',
    '### Wrong for this family — do not do these',
    ...protocol.forbidden.map(item => `- ${item}`),
    '',
    '### Your seat in this protocol',
    'Coordinator owns phase transitions and must name the step id it is moving to.',
    'Recon owns every enumeration step; it does not exploit.',
    'Exploiter owns every proving step; it does not enumerate from scratch.',
    'Reporter records only steps with evidence, and names any step that closed as not-applicable.',
    'A step may not be skipped silently. Close it with evidence or a recorded verdict.',
  )
  return lines.join('\n')
}
