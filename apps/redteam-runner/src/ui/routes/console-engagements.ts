/**
 * Operator console API — Engagements view (Phase 5, view 1).
 *
 * GET /api/console/engagements answers:
 *   {
 *     available: boolean,          // false when the engagements dir is absent
 *     reason?: string,             // present only when available is false
 *     generatedAt: string,         // ISO timestamp of this response
 *     engagements: ConsoleEngagement[]   // at most 20, live first, then newest
 *   }
 *
 * ConsoleEngagement (fields are null when the artifact that carries them is
 * missing — the console shows what the artifacts say, never an estimate):
 *   {
 *     id: string,
 *     live: boolean,               // reconciled by UiStore for live-dir runs
 *     source: "live" | "archive",  // which engagements root the run came from
 *     status: string, phase: string,
 *     target: string, mode: string,
 *     startedAt: string, updatedAt: string,
 *     actions: number,             // state.eventCount (events recorded)
 *     steps: number | null,        // metrics.json steps (post-capture only)
 *     tokens: { in: number, out: number, total: number } | null,
 *     durationMs: number | null,
 *     findings: { total: number, proven: number, provenShare: number | null },
 *     verdicts: { total: number, byDisposition: Record<string, number> } | null,
 *     layers: { ids: string[], components: Record<string, string> } | null,
 *     hasReport: boolean,
 *     error?: string               // launch/orphan failure note, when recorded
 *   }
 *
 * Sources, per engagement dir (engagements/live/<id>/ or the sibling
 * engagements/archive/<id>/): state.json is the canonical run record (the
 * same LiveState the engagements routes read); metrics.json is the harness2
 * RunMetrics written at trajectory capture (steps, tokens, harness stamp);
 * a finding counts as PROVEN when its PoC bundle poc/<finding-id>.json
 * exists — the same definition the findings route exposes as hasProof.
 * item-verdicts.json carries the per-item dispositions counted here.
 *
 * Read-only: this route reads artifacts and the store's in-memory list; it
 * writes nothing.
 */

import type { ServerResponse } from 'node:http'
import { dirname, join } from 'node:path'
import type { UiStore } from '../store.js'
import {
  consolePaths,
  existsSafe,
  listSubdirs,
  readJsonSafe,
} from '../console/shared.js'
import { json } from './http.js'

const MAX_ENGAGEMENTS = 20
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,120}$/

interface MetricsView {
  steps: number | null
  tokens: { in: number; out: number; total: number } | null
  durationMs: number | null
  layers: { ids: string[]; components: Record<string, string> } | null
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/** metrics.json (harness2 RunMetrics) → the console's steps/tokens/layers. */
function readMetrics(dir: string): MetricsView {
  const raw = readJsonSafe(join(dir, 'metrics.json'))
  if (!isRecord(raw)) return { steps: null, tokens: null, durationMs: null, layers: null }
  const tokensIn = num(raw['tokensIn'])
  const tokensOut = num(raw['tokensOut'])
  const tokens =
    tokensIn !== undefined && tokensOut !== undefined
      ? { in: tokensIn, out: tokensOut, total: tokensIn + tokensOut }
      : null
  let layers: MetricsView['layers'] = null
  const harness = raw['harness']
  if (isRecord(harness)) {
    const ids = Array.isArray(harness['layerIds'])
      ? harness['layerIds'].filter((x): x is string => typeof x === 'string')
      : []
    const components: Record<string, string> = {}
    const hashes = harness['componentHashes']
    if (isRecord(hashes)) {
      for (const [k, v] of Object.entries(hashes)) {
        // componentHashes values are already sha256 digests; the console
        // shows the digest's first 12 hex chars as the display fingerprint.
        if (typeof v === 'string') components[k] = v.slice(0, 12)
      }
    }
    if (ids.length > 0 || Object.keys(components).length > 0) layers = { ids, components }
  }
  return { steps: num(raw['steps']) ?? null, tokens, durationMs: num(raw['durationMs']) ?? null, layers }
}

/** item-verdicts.json → disposition counts; null when the artifact is absent. */
function readVerdicts(dir: string): { total: number; byDisposition: Record<string, number> } | null {
  const raw = readJsonSafe(join(dir, 'item-verdicts.json'))
  if (!Array.isArray(raw)) return null
  const byDisposition: Record<string, number> = {}
  let total = 0
  for (const v of raw) {
    if (isRecord(v) && typeof v['disposition'] === 'string') {
      byDisposition[v['disposition']] = (byDisposition[v['disposition']] ?? 0) + 1
      total++
    }
  }
  return { total, byDisposition }
}

/** Findings from a state.json record: total + PROVEN (PoC bundle present). */
function readFindings(dir: string, state: Record<string, unknown>): { total: number; proven: number; provenShare: number | null } {
  const findings = Array.isArray(state['findings']) ? state['findings'] : []
  let proven = 0
  for (const f of findings) {
    if (isRecord(f) && typeof f['id'] === 'string' && existsSafe(join(dir, 'poc', `${f['id']}.json`))) {
      proven++
    }
  }
  const total = findings.length
  return { total, proven, provenShare: total > 0 ? proven / total : null }
}

interface Entry {
  id: string
  live: boolean
  source: 'live' | 'archive'
  status: string
  phase: string
  target: string
  mode: string
  startedAt: string
  updatedAt: string
  actions: number
  steps: number | null
  tokens: { in: number; out: number; total: number } | null
  durationMs: number | null
  findings: { total: number; proven: number; provenShare: number | null }
  verdicts: { total: number; byDisposition: Record<string, number> } | null
  layers: { ids: string[]; components: Record<string, string> } | null
  hasReport: boolean
  error?: string
}

function buildEntry(dir: string, base: Omit<Entry, 'steps' | 'tokens' | 'durationMs' | 'findings' | 'verdicts' | 'layers' | 'hasReport'>, state: Record<string, unknown>): Entry {
  const m = readMetrics(dir)
  return {
    ...base,
    steps: m.steps,
    tokens: m.tokens,
    durationMs: m.durationMs,
    layers: m.layers,
    findings: readFindings(dir, state),
    verdicts: readVerdicts(dir),
    hasReport: existsSafe(join(dir, 'report.md')),
  }
}

/**
 * GET /api/console/engagements — the 20 most recent engagements, live first.
 *
 * @param store - the UI store (engagement list + engagements dir)
 * @param res - the HTTP response to write the JSON payload to
 * @returns nothing; the response is written to `res`
 */
export function handleConsoleEngagements(store: UiStore, res: ServerResponse): void {
  const generatedAt = new Date().toISOString()
  const paths = consolePaths(store)
  if (!existsSafe(paths.engagementsDir)) {
    json(res, 200, { available: false, reason: 'engagements dir not present', generatedAt, engagements: [] })
    return
  }

  const entries: Entry[] = []
  const seen = new Set<string>()

  // Live root: UiStore.list() is the canonical, reconciled view (in-memory
  // runs first, disk history after, newest first). state.json is re-read per
  // dir for the findings detail the summary does not carry.
  for (const s of store.list()) {
    if (seen.has(s.id)) continue
    seen.add(s.id)
    const dir = join(paths.engagementsDir, s.id)
    const state = readJsonSafe(join(dir, 'state.json'))
    entries.push(
      buildEntry(
        dir,
        {
          id: s.id,
          live: s.live,
          source: 'live',
          status: s.status,
          phase: s.phase,
          target: s.target,
          mode: s.mode,
          startedAt: s.startedAt,
          updatedAt: s.updatedAt,
          actions: s.eventCount,
          ...(s.error === undefined ? {} : { error: s.error }),
        },
        isRecord(state) ? state : {},
      ),
    )
  }

  // Archive root: the sibling engagements/archive/<id>/ dirs (same layout,
  // read straight from state.json — the store only tracks the live root).
  const archiveDir = join(dirname(paths.engagementsDir), 'archive')
  for (const id of listSubdirs(archiveDir)) {
    if (seen.has(id) || !SAFE_ID.test(id)) continue
    const dir = join(archiveDir, id)
    const state = readJsonSafe(join(dir, 'state.json'))
    if (!isRecord(state)) continue
    seen.add(id)
    entries.push(
      buildEntry(
        dir,
        {
          id,
          live: false,
          source: 'archive',
          status: str(state['status']) ?? 'unknown',
          phase: str(state['phase']) ?? '-',
          target: str(state['target']) ?? '(unknown)',
          mode: str(state['mode']) ?? '-',
          startedAt: str(state['startedAt']) ?? '',
          updatedAt: str(state['updatedAt']) ?? str(state['startedAt']) ?? '',
          actions: num(state['eventCount']) ?? 0,
        },
        state,
      ),
    )
  }

  entries.sort((a, b) => {
    if (a.live !== b.live) return a.live ? -1 : 1
    return a.startedAt < b.startedAt ? 1 : -1
  })

  json(res, 200, { available: true, generatedAt, engagements: entries.slice(0, MAX_ENGAGEMENTS) })
}
