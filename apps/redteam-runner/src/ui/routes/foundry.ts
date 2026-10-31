/**
 * API route — Foundry (D2 surface: API endpoints for the chat view).
 *
 * GET  /api/foundry        snapshot bundles + tiers, the app-data
 *                                  store's scan-created cases, and Gold
 *                                  Loop state, each with its source named.
 * POST /api/foundry/verify run the located gate CLI's verify over
 *                                  the frozen snapshot; per-family results.
 * POST /api/foundry/run-gold
 *                                  run the gate over the GOLD bundles;
 *                                  per-family panel/score results.
 * POST /api/foundry/loop   run one Gold Loop cycle over the store.
 *
 * Honest absence is a feature: when no snapshot or gate CLI is locatable,
 * the response says so and lists every location that was searched. Gate
 * runs spawn node with an argument array only — the snapshot path comes
 * from discovery and slugs from the manifest, never from the request.
 */

import type { ServerResponse } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  locateFoundry,
  readSnapshot,
  type FoundryBundleRow,
} from '../../foundry/locate.js'
import { parseRunOutput, parseVerifyOutput, runGateCli } from '../../foundry/gate.js'
import { loadLoopState, runLoopCycle } from '../../foundry/loop.js'
import {
  foundryStoreDir,
  listCases,
  loadRegistry,
  readSanitizerNotes,
  type FoundryCase,
} from '../../foundry/store.js'
import type { UiStore } from '../store.js'
import { json } from './http.js'

type Rec = Record<string, unknown>

const VERIFY_TIMEOUT_MS = 120_000
const RUN_TIMEOUT_MS = 600_000

/** Group bundle rows by family with pass/fail counts. */
function perFamily<T extends { slug: string; ok: boolean }>(
  rows: T[],
  familyOf: Map<string, string>,
): Array<{ family: string; total: number; ok: number; failed: number; failedSlugs: string[] }> {
  const groups = new Map<string, { family: string; total: number; ok: number; failed: number; failedSlugs: string[] }>()
  for (const row of rows) {
    const family = familyOf.get(row.slug) ?? row.slug
    const group = groups.get(family) ?? { family, total: 0, ok: 0, failed: 0, failedSlugs: [] }
    group.total++
    if (row.ok) group.ok++
    else {
      group.failed++
      group.failedSlugs.push(row.slug)
    }
    groups.set(family, group)
  }
  return [...groups.values()].sort((a, b) => a.family.localeCompare(b.family))
}

function caseRow(foundryCase: FoundryCase): Rec {
  return {
    id: foundryCase.id,
    family: foundryCase.family,
    tier: foundryCase.tier,
    origin: foundryCase.origin,
    vulnClass: foundryCase.vulnClass,
    cwe: foundryCase.cwe,
    severity: foundryCase.severity,
    payloadClass: foundryCase.payloadClass,
    proofType: foundryCase.proofType,
    endpointShape: foundryCase.endpointShape,
    sourceEngagementId: foundryCase.sourceEngagementId,
    createdAt: foundryCase.createdAt,
    lineage: foundryCase.lineage,
  }
}

/**
 * Handle GET /api/foundry.
 *
 * @param store - the UI store (its engagements dir anchors the store path)
 * @param res - the HTTP response to write
 * @returns nothing; the response is written to res
 */
export function handleFoundry(store: UiStore, res: ServerResponse): void {
  const location = locateFoundry()
  const snapshot = location.snapshotDir ? readSnapshot(location.snapshotDir) : null

  const storeDir = foundryStoreDir(store.engagementsDir)
  const cases = existsSync(storeDir) ? listCases(storeDir) : []
  const bundleEntries = existsSync(storeDir)
    ? loadRegistry(storeDir).entries.filter(e => e.kind === 'bundle')
    : []
  const loop = loadLoopState(storeDir)
  const byTier: Record<string, number> = {}
  const byFamily: Record<string, number> = {}
  for (const c of cases) {
    byTier[c.tier] = (byTier[c.tier] ?? 0) + 1
    byFamily[c.family] = (byFamily[c.family] ?? 0) + 1
  }
  for (const b of bundleEntries) {
    byTier[b.tier] = (byTier[b.tier] ?? 0) + 1
    byFamily[b.family] = (byFamily[b.family] ?? 0) + 1
  }

  json(res, 200, {
    available: location.snapshotDir !== null,
    reason: location.snapshotDir
      ? null
      : 'No Foundry snapshot located — set REDTEAM_FOUNDRY_SNAPSHOT or place the snapshot where the console searches (listed under searched).',
    snapshotDir: location.snapshotDir,
    snapshotVia: location.snapshotVia,
    searched: location.snapshotCandidates,
    snapshot,
    gate: {
      available: location.gateCliPath !== null,
      cliPath: location.gateCliPath,
      packageRoots: location.gatePackageRoots,
    },
    store: {
      dir: storeDir,
      available: existsSync(storeDir),
      cases: cases.map(caseRow),
      bundles: bundleEntries.map(e => ({
        id: e.id,
        family: e.family,
        tier: e.tier,
        origin: e.origin,
        sourceEngagementId: e.sourceEngagementId,
        lineage: e.lineage,
        createdAt: e.createdAt,
      })),
      counts: { total: cases.length + bundleEntries.length, byTier, byFamily },
      sanitizerNotes: readSanitizerNotes(storeDir, 10),
    },
    loop: {
      cyclesRun: loop.cyclesRun,
      lastCycle: loop.lastCycle,
      fitness: Object.entries(loop.fitness).map(([caseId, record]) => ({
        caseId,
        fitness: record.fitness,
        components: record.components,
        at: record.at,
      })),
    },
  })
}

/**
 * Handle POST /api/foundry/verify.
 *
 * @param _store - unused; kept for route-signature symmetry
 * @param res - the HTTP response to write
 * @returns nothing; the response is written to res
 */
export async function handleFoundryVerify(_store: UiStore, res: ServerResponse): Promise<void> {
  const location = locateFoundry()
  if (!location.snapshotDir || !location.gateCliPath) {
    json(res, 200, {
      ok: false,
      error: `gate verify unavailable: ${!location.snapshotDir ? 'no snapshot located' : 'gate CLI not located'}`,
      searched: location.snapshotCandidates,
    })
    return
  }
  const result = await runGateCli(
    location.gateCliPath,
    ['verify', '--snapshot', location.snapshotDir],
    VERIFY_TIMEOUT_MS,
  )
  const parsed = parseVerifyOutput(result.stdout)
  const snapshot = readSnapshot(location.snapshotDir)
  const familyOf = new Map<string, string>((snapshot?.bundles ?? []).map(b => [b.slug, b.family]))
  json(res, 200, {
    ok: !result.timedOut && result.spawnError === null && result.exitCode === 0,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    spawnError: result.spawnError,
    totals: { ok: parsed.okCount, total: parsed.totalCount },
    perFamily: perFamily(parsed.rows, familyOf),
    bundles: parsed.rows,
  })
}

/**
 * Handle POST /api/foundry/run-gold.
 *
 * @param _store - unused; kept for route-signature symmetry
 * @param res - the HTTP response to write
 * @returns nothing; the response is written to res
 */
export async function handleFoundryRunGold(_store: UiStore, res: ServerResponse): Promise<void> {
  const location = locateFoundry()
  if (!location.snapshotDir || !location.gateCliPath) {
    json(res, 200, {
      ok: false,
      error: `gate run unavailable: ${!location.snapshotDir ? 'no snapshot located' : 'gate CLI not located'}`,
      searched: location.snapshotCandidates,
    })
    return
  }
  const outDir = mkdtempSync(join(tmpdir(), 'foundry-gate-'))
  const outPath = join(outDir, 'report.json')
  try {
    const result = await runGateCli(
      location.gateCliPath,
      ['run', '--gold-only', '--snapshot', location.snapshotDir, '--out', outPath],
      RUN_TIMEOUT_MS,
    )
    const snapshot = readSnapshot(location.snapshotDir)
    const familyOf = new Map<string, string>((snapshot?.bundles ?? []).map(b => [b.slug, b.family]))
    const goldSlugs = new Set((snapshot?.bundles ?? []).filter(b => b.loopTier === 'GOLD').map(b => b.slug))

    let bundles: Array<{
      slug: string
      passRate: number | null
      observedTier: number | null
      assignedTier: number | null
      fitness: number | null
      gatePass: boolean | null
      error: string | null
    }> = []
    try {
      const report = JSON.parse(readFileSync(outPath, 'utf8')) as { results?: Rec[] }
      if (Array.isArray(report.results)) {
        bundles = report.results.map((r) => {
          const panel = (r['panel'] ?? null) as Rec | null
          const score = (r['score'] ?? null) as Rec | null
          return {
            slug: String(r['slug'] ?? ''),
            passRate: panel ? (panel['pass_rate'] as number) : null,
            observedTier: panel ? (panel['observed_tier'] as number | null) : null,
            assignedTier: (r['assigned_tier'] as number) ?? null,
            fitness: score ? (score['fitness'] as number) : null,
            gatePass: score ? (score['gate_pass'] as boolean) : null,
            error: (r['error'] as string) ?? null,
          }
        })
      }
    } catch {
      /* fall through to the stdout parse */
    }
    if (bundles.length === 0) {
      bundles = parseRunOutput(result.stdout).filter(r => goldSlugs.has(r.slug))
    }
    const familyRows = bundles.map(b => ({ slug: b.slug, ok: b.gatePass === true }))
    json(res, 200, {
      ok: !result.timedOut && result.spawnError === null && result.exitCode === 0,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      spawnError: result.spawnError,
      perFamily: perFamily(familyRows, familyOf),
      bundles,
    })
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
}

/**
 * Handle POST /api/foundry/loop — one Gold Loop cycle over the
 * app-data store.
 *
 * @param store - the UI store (its engagements dir anchors the store path)
 * @param res - the HTTP response to write
 * @returns nothing; the response is written to res
 */
export async function handleFoundryLoop(store: UiStore, res: ServerResponse): Promise<void> {
  const storeDir = foundryStoreDir(store.engagementsDir)
  const summary = await runLoopCycle(storeDir)
  json(res, 200, { ok: summary.error === null, summary })
}

export type { FoundryBundleRow }
