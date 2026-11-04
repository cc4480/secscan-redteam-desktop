/**
 * Chat-shaped engagement tools for the RedTeam console (v0.31.0).
 *
 * start_engagement (mcp-tools.ts) is the CLI-shaped launch: the caller must
 * construct target, mode, objective and scope exactly, the way a CLI user
 * would. That shape is why a chat agent, handed "run a full deep scan",
 * improvised with other tools instead — the launch it needed was one it had
 * to assemble perfectly before it could start anything.
 *
 * These tools are the conversation-shaped surface over the SAME route
 * handlers, so the safety core, launch validation and tier rules apply
 * unchanged:
 *
 *   engagement_launch  — target as the user gave it (sentence punctuation
 *                        cleaned, scope derived from its host, mode red by
 *                        default), objective in the user's words, and a
 *                        named operator on the record — the attestation the
 *                        authorize phase consumes.
 *   engagement_status  — one snapshot reshaped for narration in a thread:
 *                        status, phase, event and finding counts, the
 *                        halt/block reason when there is one, and the
 *                        missing files when the deliverable set failed.
 *   engagement_report  — the finished report's content for delivery in the
 *                        thread, plus the in-app artifact paths. Returns
 *                        ready:false while the run is still going.
 *   engagement_regenerate_report — (report-tools.ts) re-fires report
 *                        generation from the recorded state when a
 *                        finished engagement's deliverable set is short.
 *
 * The console chat and the desktop host's chat consume one MCP tool list
 * (mcp-endpoint.ts), so these tools appear on both surfaces at once.
 */

import { capture, type Captured, type ToolDef } from './mcp-tools.js'
import { handleDetail, handleLaunch } from './routes/engagements.js'
import { engagementDir } from './store.js'
import { readEvents, type LiveState } from '../events.js'
import { verifyDeliverables } from '../report/deliverables.js'
import { regenerateTool, reportTool } from './report-tools.js'
import { currentSeatSpeaker, findingSpeakers } from './speaker.js'
import type { UiLaunchRequest } from './types.js'
import { findSiblingCommand } from '../workflows/commands.js'

const str = (d: string): Record<string, unknown> => ({ type: 'string', description: d })
const req = (d: string): Record<string, unknown> => ({ type: 'string', description: d })

import { cleanTarget, resolveLaunchOperator, targetHost } from './launch-targets.js'
export { cleanTarget, resolveLaunchOperator, targetHost } from './launch-targets.js'

export function buildLaunchBody(a: Record<string, unknown>): { body: UiLaunchRequest } | { error: string } {
  const target = cleanTarget(typeof a['target'] === 'string' ? a['target'] : '')
  if (!target) return { error: 'target is required: name the site or host to test' }
  const objective = typeof a['objective'] === 'string' ? a['objective'].trim() : ''
  if (!objective) return { error: "objective is required: the user's ask, in their words" }
  const host = targetHost(target)
  if (!host) return { error: `could not read a host from target ${JSON.stringify(a['target'])} — give a URL or a bare host` }

  let scope: string[]
  if (Array.isArray(a['scope']) && a['scope'].length > 0 && a['scope'].every(s => typeof s === 'string' && s.trim())) {
    scope = (a['scope'] as string[]).map(s => s.trim())
  } else {
    scope = [host]
  }

  const body: UiLaunchRequest = { target, mode: a['mode'] === 'black' ? 'black' : 'red', objective, scope }
  // S2-H2: a sibling command names itself in `command`; stamp the body
  // from its registry spec — an unknown name stamps nothing. Explicit
  // tier/targets arguments override.
  const sibling = typeof a['command'] === 'string' ? findSiblingCommand(a['command']) : undefined
  if (sibling) {
    Object.assign(body, {
      command: sibling.name,
      tier: sibling.tier,
      targets: [...sibling.targets],
      phases: [...sibling.phases],
    })
  }
  if (Array.isArray(a['targets']) && a['targets'].length > 0 && a['targets'].every(s => typeof s === 'string' && s.trim())) body.targets = (a['targets'] as string[]).map(s => s.trim())
  if (Array.isArray(a['outOfScope']) && a['outOfScope'].length > 0 && a['outOfScope'].every(s => typeof s === 'string' && s.trim())) {
    body.outOfScope = (a['outOfScope'] as string[]).map(s => s.trim())
  }
  const operatorName = typeof a['operatorName'] === 'string' && a['operatorName'].trim() ? a['operatorName'].trim() : undefined
  const client = typeof a['client'] === 'string' && a['client'].trim() ? a['client'].trim() : undefined
  if (operatorName) body.operatorName = operatorName
  // Never a placeholder. The operator name IS the ownership basis the authorize
  // phase consumes, so the old "the desktop user" constant had the record attest
  // that a named person claimed ownership when nobody had. Fall back to a REAL
  // identity instead: the configured operator, then the account running the app.
  else if (!client) {
    const resolved = resolveLaunchOperator()
    if (!resolved) {
      return {
        error:
          'operatorName is required: the engagement record must name the person'
          + ' attesting ownership, and no configured operator or OS account could be resolved.',
      }
    }
    body.operatorName = resolved
  }
  if (client) body.client = client
  if (typeof a['fullBattery'] === 'boolean') body.fullBattery = a['fullBattery']
  if (a['localHost'] === true) body.localHost = true
  if (a['tier'] === 0 || a['tier'] === 1 || a['tier'] === 2) body.tier = a['tier']
  if (a['environment'] === 'staging' || a['environment'] === 'production') body.environment = a['environment']
  if (typeof a['confirmProduction'] === 'boolean') body.confirmProduction = a['confirmProduction']
  if (typeof a['confirmTier2Production'] === 'boolean') body.confirmTier2Production = a['confirmTier2Production']
  if (typeof a['maxActions'] === 'number' && Number.isFinite(a['maxActions'])) body.maxActions = a['maxActions']
  if (a['dryRun'] === true) body.dryRun = true
  return { body }
}

const ID_ONLY = (): Record<string, unknown> => ({
  type: 'object',
  properties: { id: req('Engagement id') },
  required: ['id'],
  additionalProperties: false,
})

/** engagement_launch — see the module doc for the design. */
const launchTool: ToolDef = {
  name: 'engagement_launch',
  description:
    'Start a security engagement on a target the user named, inside this app. This is the tool that fulfils a scan or test request: ' +
    'it runs the in-house pipeline (authorize from the engagement record, recon, exploit, report) and returns the engagement id. ' +
    'Give target as the user gave it — a URL or a bare host; trailing sentence punctuation is cleaned and the scope defaults to the ' +
    "target's host. objective is the user's ask in their words. After launching, poll engagement_status and narrate each phase change; " +
    'when the run completes, call engagement_report and deliver the report in the thread.',
  inputSchema: {
    type: 'object',
    properties: {
      target: req('Target as the user gave it: a URL or a bare host'),
      objective: req("The user's ask, in their words"),
      command: str("The sibling operator command being fulfilled (nmap, deepscan, nuclei, metasploit — pcscan uses engagement_launch_local). Stamps the launch with that command's registry tier, target families, and phases; omit for a plain /scan."),
      targets: { type: 'array', items: { type: 'string' }, description: "Target families for the engagement (webapp, windows, linux, cloud, api, ai, secscan, seclayer). Default: the named command's families." },
      mode: { type: 'string', enum: ['red', 'black'], description: 'red = full knowledge (default), black = no prior knowledge' },
      operatorName: str('The user asking, by name — the operator the engagement record attests'),
      client: str('Client name for the report; also attests when no operator is named'),
      scope: { type: 'array', items: { type: 'string' }, description: "Exact in-scope hosts. Default: the target's host only." },
      outOfScope: { type: 'array', items: { type: 'string' }, description: 'Exact out-of-scope hosts — never touched, even when inside scope (deny beats allow). Default: none.' },
      fullBattery: { type: 'boolean', description: 'Run the full battery (default true)' },
      tier: { type: 'integer', enum: [0, 1, 2], description: 'Autonomy tier; production defaults to 1' },
      environment: { type: 'string', enum: ['staging', 'production'] },
      confirmProduction: { type: 'boolean', description: 'Required to run against production' },
      confirmTier2Production: { type: 'boolean', description: 'Required for Tier 2 on production' },
      maxActions: { type: 'integer', description: 'Cap on agent actions for the whole engagement (default 60)' },
      dryRun: { type: 'boolean', description: 'Plan only; touch nothing' },
    },
    required: ['target', 'objective'],
    additionalProperties: false,
  },
  run: async (store, a) => {
    const built = buildLaunchBody(a)
    if ('error' in built) return { status: 400, body: { error: built.error } }
    const c = capture()
    await handleLaunch(store, {} as never, c.res, built.body)
    const out = c.result()
    if (out.status !== 202) return out
    const id = (out.body as { id?: string }).id ?? ''
    return {
      status: 202,
      body: {
        id,
        target: built.body.target,
        mode: built.body.mode,
        scope: built.body.scope,
        summary:
          `Engagement ${id} launched against ${built.body.target} (mode ${built.body.mode}). It runs in this app — ` +
          (built.body.phases ? `phases ${built.body.phases.join(', ')}${built.body.command ? ` per the /${built.body.command} command` : ''}. ` : 'authorize, recon, exploit, report. ') +
          'Poll engagement_status with this id and narrate each phase change in the thread; ' +
          'when it completes, call engagement_report and deliver the report here.',
      },
    }
  },
}

/** engagement_status — one detail snapshot reshaped for narration. */
const statusTool: ToolDef = {
  name: 'engagement_status',
  description:
    'Progress snapshot for one engagement, shaped for narrating in chat: status, current phase, event count, findings so far, ' +
    'whether it is live, and the reason when it blocked or halted. Poll this after engagement_launch and report each phase change. ' +
    'When the snapshot names a speaker, that is the fleet seat whose recorded execution the snapshot reports — attribute the narration to that seat.',
  inputSchema: ID_ONLY(),
  run: async (store, a): Promise<Captured> => {
    const id = String(a['id'] ?? '')
    const c = capture()
    handleDetail(store, c.res, id)
    const out = c.result()
    if (out.status !== 200) return out
    const b = out.body as Record<string, unknown>
    if (b['state'] == null) {
      // Still starting, or died before writing state: the in-memory record
      // is all there is, and its error field is the reason.
      const status = typeof b['status'] === 'string' ? b['status'] : 'starting'
      const error = typeof b['error'] === 'string' ? b['error'] : undefined
      return {
        status: 200,
        body: {
          id,
          status,
          phase: 'starting',
          live: b['live'] === true,
          target: b['target'] ?? null,
          findings: 0,
          eventCount: 0,
          ...(error ? { error } : {}),
          summary: error
            ? `Engagement ${id} halted before it started: ${error}`
            : `Engagement ${id} is starting — no state written yet.`,
        },
      }
    }
    const s = b['state'] as LiveState
    const findings = Array.isArray(s.findings) ? s.findings.length : 0
    // Speaker stamps (ui/speaker.ts): the seat that executed most
    // recently, from the tail of the event log's loop-stamped records,
    // and per-finding producers. Absent when the record names no seat —
    // the body is then exactly what it was before the wire existed.
    const stateDir = engagementDir(store.engagementsDir, id)
    const speaker = stateDir
      ? currentSeatSpeaker(readEvents(stateDir, Math.max(0, s.eventCount - 1000), 1000))
      : undefined
    const speakers = findingSpeakers(Array.isArray(s.findings) ? s.findings : [])
    // Q-DELIVERABLES-AUTOFIRE follow-up (diag-html-report 2026-11-01):
    // a deliverable-failed end must never summarize as plain "complete"
    // in the chat surface — name the missing files where the operator
    // actually looks, and point at the repair tool.
    const missingDeliverables =
      s.deliverableFailed === true && stateDir ? verifyDeliverables(stateDir).missing : []
    const deliverableNote =
      missingDeliverables.length > 0
        ? ` Deliverable set INCOMPLETE — missing: ${missingDeliverables.join(', ')}. Call engagement_regenerate_report to re-fire report generation.`
        : ''
    const summary =
      s.status === 'complete'
        ? missingDeliverables.length > 0
          ? `Engagement ${id} ended: ${findings} findings over ${s.eventCount} events.${deliverableNote}`
          : `Engagement ${id} is complete: ${findings} findings over ${s.eventCount} events. Call engagement_report to deliver the report.`
        : s.status === 'halted' || s.status === 'blocked'
          ? `Engagement ${id} ${s.status}${s.blockedReason ? `: ${s.blockedReason}` : ''}. ${findings} findings recorded.${deliverableNote}${s.deliverableFailed === true ? '' : ' Call engagement_report to deliver the report.'}`
          : `Engagement ${id} is ${s.status} — phase: ${s.phase}, ${s.eventCount} events, ${findings} findings so far.`
    return {
      status: 200,
      body: {
        id,
        status: s.status,
        phase: s.phase,
        live: b['live'] === true,
        verified: s.verified === true,
        target: s.target,
        findings,
        eventCount: s.eventCount,
        startedAt: s.startedAt,
        updatedAt: s.updatedAt,
        ...(s.blockedReason ? { blockedReason: s.blockedReason } : {}),
        ...(speaker ? { speaker } : {}),
        ...(Object.keys(speakers).length > 0 ? { findingSpeakers: speakers } : {}),
        ...(missingDeliverables.length > 0
          ? { deliverableFailed: true, missingDeliverables }
          : {}),
        artifacts: b['artifacts'],
        summary,
      },
    }
  },
}

/** The chat-shaped engagement tools, appended to the cockpit list.
 * Launch + status live here; report delivery + regeneration live in
 * report-tools.ts. */
export const ENGAGEMENT_TOOLS: ToolDef[] = [launchTool, statusTool, reportTool, regenerateTool]
