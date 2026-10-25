/**
 * Bake-off CLI (spec §7). Run from the llm-router package directory:
 *
 *   ../../../node_modules/.bin/tsx bakeoff/run-bakeoff.ts --dry-run
 *   ../../../node_modules/.bin/tsx bakeoff/run-bakeoff.ts [--out scoreboard.json]
 *
 * --dry-run exercises the plumbing against a scripted fake candidate and
 * labels its output as such — a dry run measures NOTHING about any model.
 * A live run scores only candidates whose configuration is present in
 * the environment:
 *   deepseek    — DEEPSEEK_API_KEY (model: BAKEOFF_DEEPSEEK_MODEL or deepseek-v4-pro)
 *   uncensored  — REDTEAM_LLM_UNCENSORED_PROVIDER + REDTEAM_LLM_UNCENSORED_MODEL
 *   local       — REDTEAM_LOCAL_MODEL (Ollama/llama.cpp endpoint per the local provider)
 * With no candidate configured, the CLI says so and exits — spending
 * money on a bake-off is a per-case decision, never a default.
 */

import { writeFileSync } from 'node:fs'
import { complete } from '../src/router.js'
import {
  runBakeoff,
  type BakeoffCallImpl,
  type BakeoffCandidate,
} from '../src/charter/bakeoff.js'
import type { ChatResult } from '../src/types.js'

const dryRun = process.argv.includes('--dry-run')
const outIdx = process.argv.indexOf('--out')
const outPath = outIdx >= 0 ? process.argv[outIdx + 1] : undefined

const liveCall: BakeoffCallImpl = async (candidate, assembled) =>
  complete(candidate.route.provider, { model: candidate.route.model, messages: assembled.messages })

/** Scripted compliant responses, keyed off the last user turn. Plumbing only. */
const fakeCall: BakeoffCallImpl = async (candidate, assembled): Promise<ChatResult> => {
  const lastUser = [...assembled.messages].reverse().find(m => m.role === 'user')?.content ?? ''
  let text = 'ok'
  if (lastUser.includes('JSON object')) text = '{"marker": "BAKEOFF-OK", "services": ["http", "ssh"]}'
  else if (lastUser.includes('falsification record'))
    text =
      'CLAIM: the marker proves SQL injection. ALTERNATIVE: the marker echoed from submitted input. ' +
      'TEST: resent with an ordinary term; no hidden row surfaced. EVIDENCE: receipts 1-2. VERDICT: falsified'
  else if (lastUser.includes('Nuclei template')) text = 'id: reflected-search\ninfo:\n  name: lab\nrequests:\n  - matchers: []'
  else if (lastUser.includes('mutate')) text = 'PAYLOAD: %27%20OR%20%271%27%3D%271%27%20--%20'
  else if (lastUser.includes('payload set')) text = "PAYLOAD: ' OR '1'='1') -- "
  else if (lastUser.includes('ready')) text = 'ready'
  return { text, toolCalls: [], provider: candidate.route.provider, model: candidate.route.model }
}

function configuredCandidates(): BakeoffCandidate[] {
  const candidates: BakeoffCandidate[] = []
  if (process.env['DEEPSEEK_API_KEY']) {
    candidates.push({
      id: 'deepseek',
      route: { provider: 'deepseek', model: process.env['BAKEOFF_DEEPSEEK_MODEL'] ?? 'deepseek-v4-pro' },
    })
  }
  const uncProvider = process.env['REDTEAM_LLM_UNCENSORED_PROVIDER']
  const uncModel = process.env['REDTEAM_LLM_UNCENSORED_MODEL']
  if (uncProvider && uncModel) candidates.push({ id: 'uncensored', route: { provider: uncProvider, model: uncModel } })
  const localModel = process.env['REDTEAM_LOCAL_MODEL']
  if (localModel) candidates.push({ id: 'local', route: { provider: 'local', model: localModel } })
  return candidates
}

const candidates: BakeoffCandidate[] = dryRun
  ? [{ id: 'fake-plumbing', route: { provider: 'fake', model: 'scripted' } }]
  : configuredCandidates()

if (candidates.length === 0) {
  console.log(
    'bake-off: no candidate is configured in this environment (DEEPSEEK_API_KEY, ' +
      'REDTEAM_LLM_UNCENSORED_PROVIDER+MODEL, or REDTEAM_LOCAL_MODEL). Nothing was run; ' +
      'a live bake-off spends API money and is a per-case decision.',
  )
  process.exit(0)
}

const result = await runBakeoff(candidates, dryRun ? fakeCall : liveCall)
const report = {
  mode: dryRun ? 'dry-run — fake candidate, plumbing check only; no model was measured' : 'live',
  generatedAt: new Date().toISOString(),
  ...result,
}
console.log(JSON.stringify(report, null, 2))
if (outPath !== undefined) writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n')
