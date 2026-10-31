/**
 * Campaign CLI (Q-CAMPAIGN, Decision C-2: the v1 surface is CLI-only).
 *
 *   campaign create --id <id> --name <n> --kind web-hunt --scope h1[,h2]
 *                   --verification <ref> --objective <text> --operator <name>
 *                   [--max-waves N] [--max-budget N] [--roe-ref <ref>]
 *   campaign list
 *   campaign status <id>
 *   campaign plan <id>                      (plan + arm the next wave)
 *   campaign advance <id> --operator <n>    (record start/advance — the C-1 gate key)
 *   campaign auto <id> --operator <n> --max-wave N
 *   campaign auto-off <id> --operator <n>
 *   campaign pause|resume|stop|complete <id> --operator <n>
 *   campaign run <id> [--mode red|black] [--tier N]   (launch the next wave, gated)
 *   campaign repair                         (restart repair of stranded waves)
 *
 * The operator commands exist because the gate is decision-shaped:
 * `advance` records the decision the gate will check at `run`. There
 * is deliberately no flag that skips the gate — run without a recorded
 * decision refuses, every time, and says which decision is missing.
 */

import { completeForRole } from '@secscan/redteam-llm-router'

import { launchCampaignWave, planNextCampaignWave } from './executor.js'
import { evaluateLaunch, nextWaveIndex, recordOperatorDecision } from './gate.js'
import { getCampaignKind } from './kinds.js'
import { completeCampaign, computeCampaignRollup, pauseCampaign, resumeCampaign, stopCampaign } from './lifecycle.js'
import type { WavePlannerCompletion } from './planner.js'
import {
  createCampaign,
  listCampaignIds,
  loadCampaign,
  resolveCampaignsDir,
  resumeCampaigns,
} from './store.js'
import type { OperatorDecisionKind } from './types.js'

export class CampaignCliError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CampaignCliError'
  }
}

/** Injectable dependencies (tests drive the CLI keyless with fakes). */
export interface CampaignCliDeps {
  campaignsDir?: string
  completion?: WavePlannerCompletion
  runFn?: typeof import('../phases/run.js').runEngagement
  out?: (line: string) => void
}

function parseArgs(argv: string[]): { positional: string[]; flags: Map<string, string | true> } {
  const positional: string[] = []
  const flags = new Map<string, string | true>()
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string
    if (a.startsWith('--')) {
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        flags.set(a, next)
        i++
      } else {
        flags.set(a, true)
      }
    } else {
      positional.push(a)
    }
  }
  return { positional, flags }
}

function reqFlag(flags: Map<string, string | true>, name: string): string {
  const v = flags.get(name)
  if (typeof v !== 'string' || v.trim() === '') throw new CampaignCliError(`missing required ${name} <value>`)
  return v
}

function optFlag(flags: Map<string, string | true>, name: string): string | undefined {
  const v = flags.get(name)
  return typeof v === 'string' ? v : undefined
}

function numFlag(flags: Map<string, string | true>, name: string): number | undefined {
  const raw = optFlag(flags, name)
  if (raw === undefined) return undefined
  const n = Number(raw)
  if (!Number.isFinite(n)) throw new CampaignCliError(`${name} must be a number, got ${JSON.stringify(raw)}`)
  return n
}

const USAGE = [
  'campaign create --id <id> --name <n> --kind web-hunt --scope h1[,h2] --verification <ref> --objective <text> --operator <name> [--max-waves N] [--max-budget N] [--roe-ref <ref>]',
  'campaign list | campaign status <id> | campaign plan <id>',
  'campaign advance <id> --operator <n> [--note <text>]',
  'campaign auto <id> --operator <n> --max-wave N | campaign auto-off <id> --operator <n>',
  'campaign pause|resume|stop|complete <id> --operator <n>',
  'campaign run <id> [--mode red|black] [--tier 1|2] [--no-full-battery]',
  'campaign repair',
].join('\n  ')

async function defaultCompletion(messages: { role: 'system' | 'user'; content: string }[]): Promise<string> {
  const res = await completeForRole('coordinator', messages, { tools: [] })
  return res.text
}

/**
 * Run one campaign CLI invocation. Returns the process exit code
 * (0 ok, 1 operational failure, 2 usage error) and never throws for
 * expected failures — the refusal IS the output.
 * @param argv - Arguments after the `campaign` command word.
 * @param deps - Injectable store/planner/runner/output dependencies.
 * @returns The exit code.
 */
export async function runCampaignCli(argv: string[], deps: CampaignCliDeps = {}): Promise<number> {
  const out = deps.out ?? ((line: string) => console.log(line))
  const dir = deps.campaignsDir ?? resolveCampaignsDir({})
  const completion = deps.completion ?? defaultCompletion
  const [sub, ...rest] = argv
  const { positional, flags } = parseArgs(rest)
  const id = positional[0]
  try {
    switch (sub) {
      case 'create': {
        const kindName = optFlag(flags, '--kind') ?? 'web-hunt'
        const kind = getCampaignKind(kindName)
        const scope = reqFlag(flags, '--scope')
          .split(',')
          .map(s => s.trim())
          .filter(s => s !== '')
        if (scope.length === 0) throw new CampaignCliError('--scope must name at least one host')
        const maxBudget = numFlag(flags, '--max-budget') ?? kind.defaults.maxBudget
        const rec = createCampaign(dir, {
          id: reqFlag(flags, '--id'),
          name: reqFlag(flags, '--name'),
          kind: kind.name,
          scope: {
            hosts: scope,
            verificationRef: reqFlag(flags, '--verification'),
            ...(optFlag(flags, '--roe-ref') ? { roeRef: optFlag(flags, '--roe-ref') } : {}),
          },
          objective: reqFlag(flags, '--objective'),
          caps: {
            maxWaves: numFlag(flags, '--max-waves') ?? kind.defaults.maxWaves,
            ...(maxBudget !== undefined ? { maxBudget } : {}),
          },
          createdBy: reqFlag(flags, '--operator'),
        })
        out(`[campaign] created ${rec.id} (${rec.kind}) — status ${rec.status}, scope ${rec.scope.hosts.join(', ')}`)
        out(`[campaign] wave 1 needs a recorded start decision: campaign advance ${rec.id} --operator <name>`)
        return 0
      }
      case 'list': {
        const ids = listCampaignIds(dir)
        if (ids.length === 0) {
          out('[campaign] no campaigns')
          return 0
        }
        for (const cid of ids) {
          try {
            const rec = loadCampaign(dir, cid)
            out(`${rec.id}  ${rec.status}  kind=${rec.kind}  waves=${rec.waves.filter(w => w.launchedAt).length}/${rec.caps.maxWaves}  scope=${rec.scope.hosts.join(',')}`)
          } catch (err) {
            out(`${cid}  ERROR ${(err as Error).message}`)
          }
        }
        return 0
      }
      case 'status': {
        if (!id) throw new CampaignCliError('status needs a campaign id')
        const rec = loadCampaign(dir, id)
        out(JSON.stringify({ ...rec, rollup: computeCampaignRollup(rec) }, null, 2))
        return 0
      }
      case 'plan': {
        if (!id) throw new CampaignCliError('plan needs a campaign id')
        const { campaign, plan } = await planNextCampaignWave(dir, id, { completion })
        out(`[campaign] wave ${plan.waveIndex} planned for ${campaign.id} (${plan.source}${plan.fallbackReason ? `: ${plan.fallbackReason}` : ''})`)
        out(`[campaign] aim: ${plan.aim}`)
        out(`[campaign] focus: ${plan.focusVectors.join(', ')}`)
        const gate = evaluateLaunch(campaign, plan.waveIndex)
        out(`[campaign] gate: ${gate.allowed ? 'launch authorized' : `NOT authorized — ${gate.reason ?? ''}`}`)
        return 0
      }
      case 'advance': {
        if (!id) throw new CampaignCliError('advance needs a campaign id')
        const operator = reqFlag(flags, '--operator')
        const rec = loadCampaign(dir, id)
        const planned = rec.waves.find(w => w.status === 'planned')
        const waveIndex = planned ? planned.index : nextWaveIndex(rec)
        const kind: OperatorDecisionKind = waveIndex === 1 ? 'start' : 'advance'
        recordOperatorDecision(dir, id, {
          operator,
          kind,
          ...(kind === 'advance' ? { waveIndex } : {}),
          ...(optFlag(flags, '--note') ? { note: optFlag(flags, '--note') } : {}),
        })
        const gate = evaluateLaunch(loadCampaign(dir, id), waveIndex)
        out(`[campaign] recorded "${kind}" by ${operator} for wave ${waveIndex} of ${id}`)
        out(`[campaign] gate: ${gate.allowed ? `wave ${waveIndex} may launch` : (gate.reason ?? 'not authorized')}`)
        return gate.allowed ? 0 : 1
      }
      case 'auto':
      case 'auto-off': {
        if (!id) throw new CampaignCliError(`${sub} needs a campaign id`)
        const operator = reqFlag(flags, '--operator')
        if (sub === 'auto') {
          const maxWave = numFlag(flags, '--max-wave')
          if (maxWave === undefined || !Number.isInteger(maxWave) || maxWave < 1) {
            throw new CampaignCliError('auto needs --max-wave <N> (auto-advance is always capped)')
          }
          recordOperatorDecision(dir, id, { operator, kind: 'enable-auto-advance', maxWave })
          out(`[campaign] auto-advance ENABLED by ${operator} through wave ${maxWave} on ${id} (recorded decision; disable with auto-off)`)
        } else {
          recordOperatorDecision(dir, id, { operator, kind: 'disable-auto-advance' })
          out(`[campaign] auto-advance DISABLED by ${operator} on ${id} — waves are operator-gated again`)
        }
        return 0
      }
      case 'pause':
      case 'resume':
      case 'stop':
      case 'complete': {
        if (!id) throw new CampaignCliError(`${sub} needs a campaign id`)
        const operator = reqFlag(flags, '--operator')
        recordOperatorDecision(dir, id, { operator, kind: sub })
        const updated =
          sub === 'pause'
            ? pauseCampaign(dir, id)
            : sub === 'resume'
              ? resumeCampaign(dir, id)
              : sub === 'stop'
                ? stopCampaign(dir, id)
                : completeCampaign(dir, id)
        out(`[campaign] ${id} -> ${updated.status} (decision by ${operator})`)
        return 0
      }
      case 'run': {
        if (!id) throw new CampaignCliError('run needs a campaign id')
        const mode = optFlag(flags, '--mode')
        if (mode !== undefined && mode !== 'red' && mode !== 'black') {
          throw new CampaignCliError(`--mode must be red or black, got ${JSON.stringify(mode)}`)
        }
        const tierRaw = numFlag(flags, '--tier')
        if (tierRaw !== undefined && tierRaw !== 1 && tierRaw !== 2) {
          throw new CampaignCliError('--tier must be 1 or 2')
        }
        const result = await launchCampaignWave({
          campaignsDir: dir,
          campaignId: id,
          completion,
          ...(deps.runFn ? { runFn: deps.runFn } : {}),
          engagement: {
            ...(mode ? { mode } : {}),
            ...(tierRaw !== undefined ? { tier: tierRaw as 1 | 2 } : {}),
            ...(flags.has('--no-full-battery') ? { fullBattery: false } : {}),
            ...(optFlag(flags, '--operator-name') ? { operatorName: optFlag(flags, '--operator-name') } : {}),
          },
        })
        out(`[campaign] wave ${result.wave.index} of ${id}: engagement ${result.engagement.engagementId} -> ${result.engagement.status}`)
        out(
          `[campaign] findings: ${result.wave.outcome?.rollup.totalFindings ?? 0} (confirmed ${result.wave.outcome?.rollup.confirmed ?? 0}, killed ${result.wave.outcome?.rollup.killed ?? 0}, deferred ${result.wave.outcome?.rollup.deferred ?? 0}) — campaign now ${result.campaign.status}`,
        )
        return result.engagement.status === 'complete' ? 0 : 1
      }
      case 'repair': {
        const report = resumeCampaigns(dir)
        out(`[campaign] repair: scanned ${report.scanned}, repaired ${report.repaired.length}, ${report.errors.length} error(s)`)
        for (const r of report.repaired) {
          out(`[campaign] repaired ${r.id}: wave(s) ${r.interruptedWaves.join(', ') || 'none'} interrupted (${r.fromStatus} -> ${r.toStatus})`)
        }
        for (const e of report.errors) out(`[campaign] ERROR ${e.id}: ${e.error}`)
        return report.errors.length === 0 ? 0 : 1
      }
      default:
        out(`[campaign] usage:\n  ${USAGE}`)
        return 2
    }
  } catch (err) {
    if (err instanceof CampaignCliError) {
      out(`[campaign] ${err.message}`)
      return 2
    }
    out(`[campaign] ${(err as Error).message}`)
    return 1
  }
}
