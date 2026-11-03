/**
 * The RedTeam command definitions: `/scan`, `/status`, `/report`, `/stop`,
 * and `/use` over the harness command registry, plus the sibling
 * engagement commands `/pcscan`, `/deepscan`, `/nmap`, `/nuclei`, and
 * `/metasploit`.
 *
 * `/scan`, `/status`, and `/report` submit one fixed operator-directive
 * user message (see directive.ts) that routes the session's Lead through
 * the engagement tools it already owns — the same launch/status/report
 * flow a typed request takes, made deterministic at the command seam.
 * The siblings submit their own directives, each naming the command and
 * carrying its registry tier, target families, and phase list as
 * `engagement_launch` arguments (S2-H2), so a sibling run is the bounded
 * run its registry entry defines — not a plain `/scan`. `/pcscan` names
 * no target: its directive routes through `engagement_launch_local`.
 * `/stop` cancels the active turn through the agent's own cancellation
 * path. `/use` validates its tool name against the tools service's real
 * per-agent catalog and steers the running driver with the directive.
 */

import type { Context } from '@deepseek-ai/cordis'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
import type { CommandDefinition, CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import {
  SCAN_USAGE,
  USE_USAGE,
  catalogSample,
  parseUseInput,
  pcscanDirective,
  reportDirective,
  scanDirective,
  siblingDirective,
  siblingUsage,
  statusDirective,
  useDirective,
  type SiblingSpec,
} from './directive.js'

/** The slice of the tools service the `/use` handler resolves at call time. */
interface ToolCatalog {
  /** Resolve one tool name as one agent's scope sees it. */
  get(name: string, scope?: unknown): { readonly name: string } | undefined
  /** Project the tool names visible to one agent's scope. */
  schemas(scope?: unknown): readonly { readonly name: string }[]
}

/** Catalog names shown in a `/use` rejection before the count note. */
const CATALOG_SAMPLE_LIMIT = 40

/**
 * The tools service when the profile composed one. Resolved per invocation
 * through `ctx.get` so a profile without the service degrades to an honest
 * error instead of failing this plugin's activation.
 * @param ctx - the plugin context.
 * @returns the catalog face, or `undefined` when no tools service exists.
 */
function toolCatalog(ctx: Context): ToolCatalog | undefined {
  return ctx.get('tools') as ToolCatalog | undefined
}

/** Queue one directive as the sole message of its own follow-up turn. */
function followupDirective(invocation: CommandInvocation, text: string): void {
  invocation.agent.followup(createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }))
}

/** Execute `/scan`: route the trimmed target into the engagement-launch flow. */
function executeScan(invocation: CommandInvocation): CommandResult {
  const target = invocation.rawInput.trim()
  if (target === '') return { kind: 'error', text: SCAN_USAGE }
  followupDirective(invocation, scanDirective(target))
  return {
    kind: 'success',
    text: `Scan directive queued for ${target}: the Lead will launch the engagement and report progress in this thread.`,
  }
}

/**
 * The sibling engagement commands and the registry semantics each one
 * carries (S2-H2). This table mirrors the runner's command registry
 * (apps/redteam-runner/src/workflows/commands.ts COMMANDS) — the tier,
 * phase list, default target families, and approval requirement of each
 * sibling — because this package cannot import the runner; the values
 * are the registry's, kept verbatim.
 */
const SIBLINGS: readonly { name: string; description: string; spec: SiblingSpec }[] = [
  {
    name: 'deepscan',
    description: 'Full battery across the selected families with proof discipline',
    spec: { tier: 1, phases: ['recon', 'exploit', 'report'], targets: ['webapp', 'windows', 'linux'], requiresApproval: true },
  },
  {
    name: 'nmap',
    description: 'Port and service discovery only (recon + report, tier 0)',
    spec: { tier: 0, phases: ['recon', 'report'], targets: ['windows', 'linux'], requiresApproval: false },
  },
  {
    name: 'nuclei',
    description: 'Template-based checks through the nuclei bridge',
    spec: { tier: 1, phases: ['recon', 'exploit', 'report'], targets: ['webapp'], requiresApproval: false },
  },
  {
    name: 'metasploit',
    description: 'CVE validation through the Metasploit bridge (tier 2, approval required)',
    spec: { tier: 2, phases: ['recon', 'exploit', 'report'], targets: ['windows', 'linux'], requiresApproval: true },
  },
]

/** Execute one sibling command: route the trimmed target into its directive. */
function executeSibling(name: string, spec: SiblingSpec, invocation: CommandInvocation): CommandResult {
  const target = invocation.rawInput.trim()
  if (target === '') return { kind: 'error', text: siblingUsage(name) }
  followupDirective(invocation, siblingDirective(name, target, spec))
  return {
    kind: 'success',
    text: `${name} directive queued for ${target}: the Lead will launch the /${name} engagement (tier ${spec.tier}, phases ${spec.phases.join('+')}) and report progress in this thread.`,
  }
}

/** Execute `/pcscan`: route into the local-launch flow; no target is taken. */
function executePcscan(invocation: CommandInvocation): CommandResult {
  followupDirective(invocation, pcscanDirective())
  return {
    kind: 'success',
    text: 'Local scan directive queued: the Lead will launch the local host assessment and report progress in this thread.',
  }
}

/** Execute `/status`: route an engagement_status call to the Lead. */
function executeStatus(invocation: CommandInvocation): CommandResult {
  if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /status (no arguments)' }
  followupDirective(invocation, statusDirective())
  return { kind: 'success', text: 'Status directive queued: the Lead will report the current engagement snapshot in this thread.' }
}

/** Execute `/report`: route an engagement_report call to the Lead. */
function executeReport(invocation: CommandInvocation): CommandResult {
  if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /report (no arguments)' }
  followupDirective(invocation, reportDirective())
  return { kind: 'success', text: 'Report directive queued: the Lead will deliver the finished report in this thread.' }
}

/**
 * Execute `/stop`: abort the active turn through the agent's cancellation
 * path — the same stop the composer's stop button invokes. A running
 * engagement is a separate engine-side run and is deliberately NOT aborted
 * here; its halt control is the Watch tab's Abort, and the result says so.
 */
function executeStop(invocation: CommandInvocation): CommandResult {
  if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /stop (no arguments)' }
  invocation.agent.cancel({ kind: 'user' })
  return {
    kind: 'success',
    text: 'Stop sent: the active turn is aborted. A running engagement is not aborted by /stop — halt it from the Watch tab\'s Abort control.',
  }
}

/** Execute `/use`: validate the tool against the real catalog, then steer. */
function executeUse(ctx: Context, invocation: CommandInvocation): CommandResult {
  const parsed = parseUseInput(invocation.rawInput)
  const catalog = toolCatalog(ctx)
  if (parsed === undefined) {
    const sample = catalog === undefined
      ? ''
      : ` Tools available to this seat: ${catalogSample(catalog.schemas(invocation.agent).map(schema => schema.name), CATALOG_SAMPLE_LIMIT)}.`
    return { kind: 'error', text: `${USE_USAGE}${sample}` }
  }
  if (catalog === undefined) {
    return { kind: 'error', text: '/use is unavailable: no tool catalog service is composed in this profile, so the tool name cannot be validated.' }
  }
  if (catalog.get(parsed.tool, invocation.agent) === undefined) {
    const names = catalog.schemas(invocation.agent).map(schema => schema.name)
    return {
      kind: 'error',
      text: `Unknown tool "${parsed.tool}" — nothing was sent to the agent. Tools available to this seat: ${catalogSample(names, CATALOG_SAMPLE_LIMIT)}.`,
    }
  }
  invocation.agent.steer(createUserMessage({
    content: [{ type: 'text', text: useDirective(parsed.tool, parsed.instruction) }],
    source: { kind: 'user' },
  }))
  return { kind: 'success', text: `Directive sent: the agent's next tool action will use ${parsed.tool}.` }
}

/**
 * Build the RedTeam command definitions bound to one plugin context:
 * the five original commands plus the five sibling engagement commands.
 * @param ctx - the plugin context; the tools service is resolved from it
 *   at invocation time, never captured at registration time.
 * @returns the definitions to register with the command registry.
 */
export function createRedteamCommandDefinitions(ctx: Context): CommandDefinition[] {
  return [
    {
      definitionId: CommandDefinitionId('@secscan/redteam-command/scan'),
      name: 'scan',
      description: 'Launch a red-team engagement against a target',
      input: { hint: '<target>' },
      handler: invocation => executeScan(invocation),
    },
    {
      definitionId: CommandDefinitionId('@secscan/redteam-command/pcscan'),
      name: 'pcscan',
      description: 'Local host assessment of this workstation',
      input: { hint: '[quick|full]' },
      handler: invocation => executePcscan(invocation),
    },
    ...SIBLINGS.map((sibling): CommandDefinition => ({
      definitionId: CommandDefinitionId(`@secscan/redteam-command/${sibling.name}`),
      name: sibling.name,
      description: sibling.description,
      input: { hint: '<target>' },
      handler: invocation => executeSibling(sibling.name, sibling.spec, invocation),
    })),
    {
      definitionId: CommandDefinitionId('@secscan/redteam-command/status'),
      name: 'status',
      description: 'Show the current engagement status',
      handler: invocation => executeStatus(invocation),
    },
    {
      definitionId: CommandDefinitionId('@secscan/redteam-command/report'),
      name: 'report',
      description: 'Deliver the latest engagement report in this thread',
      handler: invocation => executeReport(invocation),
    },
    {
      definitionId: CommandDefinitionId('@secscan/redteam-command/stop'),
      name: 'stop',
      description: 'Stop the active turn',
      handler: invocation => executeStop(invocation),
    },
    {
      definitionId: CommandDefinitionId('@secscan/redteam-command/use'),
      name: 'use',
      description: 'Direct the agent to use a named tool for its next action',
      input: { hint: '<tool> [instruction]' },
      handler: invocation => executeUse(ctx, invocation),
    },
  ]
}
