/**
 * Recorded-state loaders for report regeneration: the report model,
 * ledger totals, PoC bundles, narrative and probe count read back from
 * a closed engagement (split from regenerate.ts — the 300-line budget).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { type ReportModel } from './deliverables.js'
import { ledgerSummary, type ItemVerdict } from '../coverage/items.js'
import { type PocBundle } from '../proof/index.js'

/**
 * The report-phase marker where runner-computed sections begin in
 * report.md; everything before it is the narrative the phase handed the
 * HTML renderer.
 */
const NARRATIVE_CUT = '\n\n---\n\n## Battery coverage (runner-computed)'

/**
 * The recorded report model, when report.json survived the close. A file
 * that is missing, unparseable, or not a report model is no model at all —
 * the caller falls back to the state record or fails typed.
 */
export function loadRecordedModel(dir: string): ReportModel | null {
  const path = join(dir, 'report.json')
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as ReportModel
    if (parsed?.kind !== 'secscan-redteam-report' || !Array.isArray(parsed.findings)) return null
    return parsed
  } catch {
    return null
  }
}

/** Battery totals from the recorded item ledger (item-verdicts.json),
 * when the phase wrote one; an absent ledger is an empty record. */
export function ledgerTotals(dir: string): ReportModel['batteryTotals'] {
  const empty = { total: 0, confirmed: 0, executedClean: 0, killed: 0, blocked: 0, na: 0, pending: 0 }
  const path = join(dir, 'item-verdicts.json')
  if (!existsSync(path)) return empty
  try {
    const entries = JSON.parse(readFileSync(path, 'utf8')) as ItemVerdict[]
    if (!Array.isArray(entries)) return empty
    const s = ledgerSummary(new Map(entries.map(v => [v.key, v])))
    return {
      total: s.total, confirmed: s.confirmed, executedClean: s.executedClean,
      killed: s.killed, blocked: s.blocked, na: s.na, pending: s.pending,
    }
  } catch {
    return empty
  }
}

/** The PoC bundles the run wrote to poc/*.json, keyed by finding id —
 * the same files the package zip ships, read back verbatim. */
export function loadBundles(dir: string): Map<string, PocBundle> {
  const out = new Map<string, PocBundle>()
  const pocDir = join(dir, 'poc')
  if (!existsSync(pocDir)) return out
  for (const name of readdirSync(pocDir).filter(n => n.endsWith('.json')).sort()) {
    try {
      const bundle = JSON.parse(readFileSync(join(pocDir, name), 'utf8')) as PocBundle
      if (typeof bundle?.findingId === 'string') out.set(bundle.findingId, bundle)
    } catch {
      // A corrupt bundle file is skipped, never fabricated around.
    }
  }
  return out
}

/** The narrative as the phase handed it to the renderer: report.md up
 * to the first runner-computed section. */
export function recordedNarrative(dir: string): string {
  const path = join(dir, 'report.md')
  if (!existsSync(path)) return ''
  const md = readFileSync(path, 'utf8')
  const cut = md.indexOf(NARRATIVE_CUT)
  return cut >= 0 ? md.slice(0, cut) : md
}

/** The probe total the phase printed into report.md's battery line —
 * recorded data, read back; 0 when the line is absent. */
export function recordedProbes(dir: string): number {
  const path = join(dir, 'report.md')
  if (!existsSync(path)) return 0
  const m = readFileSync(path, 'utf8').match(/(\d+) probes total/)
  const probes = m?.[1]
  return probes === undefined ? 0 : Number.parseInt(probes, 10)
}
