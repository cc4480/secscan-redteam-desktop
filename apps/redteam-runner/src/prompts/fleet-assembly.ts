/**
 * Fleet prompt assembly (Phase 2 W3): every live seat's system prompt is
 * assembled by @secscan/redteam-fleet-skills, in the prompt pack's fixed
 * order —
 *
 *   master → soul → verified-engagement injection → knobs → seat delta →
 *   Layer-1 skills index → Layer-2 skill bodies for the seat's phase
 *
 * The seat delta is the runner's EXISTING role prompt (coordinator.ts,
 * recon.ts, exploiter.ts, reporter.ts): nothing in those prompts is
 * deleted, the fleet layers wrap them. The package's own seat assets
 * (prompts/seats/*.md in the fleet package) are deliberately NOT also
 * spliced in — the runner prompts are their supersets (persona, doctrine,
 * ROE, batteries), and stacking both would double every persona block.
 *
 * The engagement record comes from the AUTHORIZE phase's stamped output
 * on the engagement context (see {@link verifiedRecordFor}): the fleet
 * prompt is built from the record that was actually attested, never from
 * the launch request alone. A context without that record renders the
 * historical seat text unchanged — that is the engagement-independent
 * path (the agent-docs canonical context, unit fixtures). Production is
 * gated in runEngagement, which requires the record immediately after a
 * successful authorize and fails loud without it, so a live engagement
 * never reaches a prompt without its attested record.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assembleFleetPrompt,
  discoverSkills,
  loadSkillBody,
  resolveKnobs,
  skillIndexBlock,
  type ResolvedKnobs,
  type SkillMeta,
  type VerifiedEngagementRecord,
} from '@secscan/redteam-fleet-skills'
import type { Ctx } from '../context.js'
import type { PromptContext } from './shared.js'

/** The fleet seats this module assembles prompts for. */
export type FleetSeatRole = 'coordinator' | 'recon' | 'exploiter' | 'reporter' | 'coder'

/** Soul asset (prompts/souls/<name>.md in the fleet package) per seat. */
const SOUL_BY_ROLE: Readonly<Record<FleetSeatRole, string>> = {
  coordinator: 'morpheus',
  recon: 'operator',
  exploiter: 'neo',
  reporter: 'architect',
  coder: 'tank',
}

/**
 * Layer-2 skill bodies attached per seat: the skills whose tool families
 * the seat's phase actually drives (tools/compose.ts phase sets). Every
 * other skill stays Layer-1 (index only) until it triggers.
 */
const SKILLS_BY_ROLE: Readonly<Record<FleetSeatRole, readonly string[]>> = {
  coordinator: ['redteam-ops-coordination'],
  recon: ['deep-research-osint', 'webapp-scan'],
  exploiter: ['webapp-exploit', 'browser-action-execution'],
  reporter: ['findings-grading-reporting', 'html-report-design'],
  coder: ['exploit-coding-toolbuilding'],
}

/** The knob sources and record a production prompt context carries. */
export interface FleetPromptInput {
  /** The verified engagement record (see {@link verifiedRecordFor}). */
  record: VerifiedEngagementRecord
  /** Fleet-wide CHARTER knob text (Prompt Pack §4), when a source exists. */
  charterKnobs?: string
  /** Per-engagement ENGAGEMENT knob text; wins over the charter text. */
  engagementKnobs?: string
}

/**
 * Resolve the fleet-skills package root. Candidates cover, in order: the
 * REDTEAM_FLEET_SKILLS_ROOT override, the installed workspace package
 * (node_modules, either side of the apps/ tree), the source-tree sibling
 * (src/prompts, dist/prompts, and dist-test/src/prompts all sit at a
 * depth one of the two traversals below matches), and vendored layouts
 * (the package copied beside the runner root or beside this module, as
 * the desktop vendor step places payload assets).
 *
 * @returns the first candidate directory holding prompts/master.md
 * @throws Error listing the searched candidates when none holds the assets
 */
export function fleetPackageRoot(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url))
  const override = process.env['REDTEAM_FLEET_SKILLS_ROOT']
  const candidates: string[] = [
    ...(override ? [override] : []),
    join(moduleDir, '..', '..', 'node_modules', '@secscan', 'redteam-fleet-skills'),
    join(moduleDir, '..', '..', '..', 'node_modules', '@secscan', 'redteam-fleet-skills'),
    join(moduleDir, '..', '..', '..', '..', 'packages', 'redteam', 'fleet-skills'),
    join(moduleDir, '..', '..', '..', '..', '..', 'packages', 'redteam', 'fleet-skills'),
    join(moduleDir, '..', '..', 'fleet-skills'),
    join(moduleDir, '..', 'fleet-skills'),
    join(moduleDir, 'fleet-skills'),
  ]
  // The desktop vendor step places the assets under lib/fleet-skills/
  // inside the installed package (vendor-redteam-runner.mjs), so every
  // candidate is also tried at that depth.
  const searched = candidates.flatMap(candidate => [candidate, join(candidate, 'lib', 'fleet-skills')])
  for (const candidate of searched) {
    if (existsSync(join(candidate, 'prompts', 'master.md'))) return candidate
  }
  throw new Error(
    `fleetPackageRoot: fleet-skills assets not found; searched: ${searched.join(', ')}`,
  )
}

/** The package assets the assembler consumes, loaded once per process. */
interface FleetAssets {
  master: string
  souls: ReadonlyMap<string, string>
  skillIndex: string
  skillBodies: ReadonlyMap<string, string>
}

let assetsCache: FleetAssets | undefined

/**
 * Load (and cache) the fleet package's prompt assets: the master prompt,
 * every soul, the Layer-1 index over the bundled skills root, and every
 * skill body keyed by name.
 *
 * @returns the cached asset set
 * @throws Error when the package root or a required asset cannot be read
 */
function fleetAssets(): FleetAssets {
  if (assetsCache) return assetsCache
  const root = fleetPackageRoot()
  const read = (rel: string): string => readFileSync(join(root, rel), 'utf8')
  const souls = new Map<string, string>()
  for (const name of new Set(Object.values(SOUL_BY_ROLE))) {
    souls.set(name, read(join('prompts', 'souls', `${name}.md`)))
  }
  const metas: SkillMeta[] = discoverSkills([join(root, 'skills')])
  const skillBodies = new Map<string, string>()
  for (const meta of metas) skillBodies.set(meta.name, loadSkillBody(meta))
  assetsCache = {
    master: read(join('prompts', 'master.md')),
    souls,
    skillIndex: skillIndexBlock(metas),
    skillBodies,
  }
  return assetsCache
}

/**
 * Render the rules of engagement as the one-line summary the engagement
 * injection carries. Built from the engagement's own ROE and mode; the
 * full ROE block remains in the seat-delta layer below it.
 *
 * @param ctx - the engagement context
 * @returns the RoE summary text for the record's `roe` field
 */
function roeSummary(ctx: Ctx): string {
  const roe = ctx.input.roe
  const parts = [
    `Mode: ${ctx.input.mode.toUpperCase()}`,
    `Objective: ${ctx.input.objective}`,
    `Scope: ${roe.scope.join(', ')}`,
  ]
  if (roe.outOfScope?.length) parts.push(`Out of scope: ${roe.outOfScope.join(', ')}`)
  if (roe.excludedTechniques?.length) {
    parts.push(`Excluded techniques: ${roe.excludedTechniques.join(', ')}`)
  }
  if (roe.stopConditions?.length) parts.push(`Stop conditions: ${roe.stopConditions.join('; ')}`)
  if (roe.blackoutWindows?.length) {
    parts.push(
      `Blackout windows: ${roe.blackoutWindows.map(w => `${w.start}-${w.end}${w.tz ? ` ${w.tz}` : ''}`).join(', ')}`,
    )
  }
  if (roe.notes) parts.push(`Notes: ${roe.notes}`)
  return parts.join('. ')
}

/**
 * Build the fleet package's verified engagement record from the AUTHORIZE
 * phase's stamped output on the engagement context. Field mapping:
 *
 *   engagementId / recordId ← Ctx.events.engagementId (run.ts mints it)
 *   operator  ← EngagementInput.operatorName ?? client (types.ts)
 *   owner     ← EngagementInput.client ?? operatorName ?? Ctx.domain
 *   proofMethod ← Ctx.verificationProof (context.ts; authorize.ts stamps
 *                 the attestation / service verdict / test-mode text)
 *   verifiedAt  ← Ctx.verifiedAt (context.ts; authorize.ts stamps it
 *                 beside the proof on every success path)
 *   targets   ← Ctx.hosts (the scope hosts authorize checked), falling
 *               back to Ctx.verifiedScope (authorize's attested raw scope
 *               entries), then the input target
 *   outOfScope ← RulesOfEngagement.outOfScope (deny beats allow)
 *   accessLevel ← 'verified-domain' (authorize is the precondition)
 *   roe       ← {@link roeSummary} over the input ROE + mode + objective
 *   sessionsAllowed ← true here; the SESSIONS knob narrows it at assembly
 *
 * @param ctx - the engagement context, after authorize has run
 * @returns the verified engagement record for prompt assembly
 * @throws Error when authorize has not stamped proof data — a production
 *   fleet prompt is never assembled from an unattested record
 */
export function verifiedRecordFor(ctx: Ctx): VerifiedEngagementRecord {
  if (!ctx.verificationProof || !ctx.verifiedAt) {
    throw new Error(
      '[runner] fleet prompt assembly requires the authorize phase\u2019s verification record ' +
        `(verificationProof ${ctx.verificationProof ? 'present' : 'ABSENT'}, verifiedAt ${ctx.verifiedAt ? 'present' : 'ABSENT'}) — ` +
        'promptCtx was called before authorize stamped them. Refusing to assemble a fleet prompt without proof data.',
    )
  }
  const targets =
    ctx.hosts.length > 0
      ? [...ctx.hosts]
      : ctx.verifiedScope && ctx.verifiedScope.length > 0
        ? [...ctx.verifiedScope]
        : [ctx.input.target]
  return {
    engagementId: ctx.events.engagementId,
    operator: ctx.input.operatorName ?? ctx.input.client ?? 'the engagement operator',
    owner: ctx.input.client ?? ctx.input.operatorName ?? ctx.domain,
    proofMethod: ctx.verificationProof,
    recordId: ctx.events.engagementId,
    verifiedAt: ctx.verifiedAt,
    targets,
    ...(ctx.input.roe.outOfScope?.length ? { outOfScope: [...ctx.input.roe.outOfScope] } : {}),
    accessLevel: 'verified-domain',
    roe: roeSummary(ctx),
    sessionsAllowed: true,
  }
}

/**
 * Assemble one seat's complete system prompt through the fleet package,
 * in the pack order (see the module header). Contexts that carry no
 * fleet input — the agent-docs canonical context and unit fixtures —
 * return the seat text unchanged, byte for byte.
 *
 * The SESSIONS knob narrows the record's session rule at assembly: with
 * SESSIONS=off in the charter/engagement knob sources, the injection
 * renders the no-sessions rule instead of the W8 session rule.
 *
 * @param role - the fleet seat the prompt is for
 * @param seatText - the runner's existing role prompt (the seat delta)
 * @param ctx - the prompt context; carries the fleet input in production
 * @returns the assembled system prompt, or `seatText` unchanged when the
 *   context carries no fleet input
 * @throws Error when a mapped soul or skill body is missing from the
 *   fleet package (a broken package must fail loud, not prompt silently)
 */
export function buildFleetPrompt(
  role: FleetSeatRole,
  seatText: string,
  ctx: PromptContext,
): string {
  if (!ctx.fleet) return seatText
  const assets = fleetAssets()
  const knobs: ResolvedKnobs = resolveKnobs(ctx.fleet.charterKnobs, ctx.fleet.engagementKnobs)
  const record: VerifiedEngagementRecord = {
    ...ctx.fleet.record,
    sessionsAllowed: ctx.fleet.record.sessionsAllowed && knobs.values['SESSIONS'] !== 'off',
  }
  const soulName = SOUL_BY_ROLE[role]
  const soul = assets.souls.get(soulName)
  if (!soul) throw new Error(`buildFleetPrompt: soul asset "${soulName}" missing for role ${role}`)
  const skillBodies: { name: string; body: string }[] = []
  for (const name of SKILLS_BY_ROLE[role]) {
    const body = assets.skillBodies.get(name)
    if (!body) throw new Error(`buildFleetPrompt: skill body "${name}" missing for role ${role}`)
    skillBodies.push({ name, body })
  }
  return assembleFleetPrompt({
    master: assets.master,
    soul,
    record,
    knobs,
    seatDelta: seatText,
    skillIndex: assets.skillIndex,
    skillBodies,
  })
}
