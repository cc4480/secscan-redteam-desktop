/**
 * Battery status preamble for the report phase: full-battery cell
 * states, the item-ledger reconciliation write, and the battery status
 * lines the narrative and deliverables share (split from phase.ts —
 * the 300-line budget).
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BATTERY_CATEGORIES } from '../battery.js'
import { TARGET_PROFILES, activeTargets, targetCellStatus } from '../targets.js'
import { ledgerSummary, serializeLedger } from '../coverage/items.js'
import { batteryStatusLine } from '../coverage/cells.js'
import { type Ctx } from '../context.js'

export function computeBatteryStatus(ctx: Ctx) {
  const selected = ctx.input.fullBattery ? activeTargets(ctx.input) : []
  const fbCells = selected.flatMap(t => BATTERY_CATEGORIES.map(c => ({ t, c })))
  const fbStatus = fbCells.map(({ t, c }) => ({ t, c, s: targetCellStatus(TARGET_PROFILES[t], c, ctx.targetCoverage.get(t)) }))
  const fbDone = fbStatus.filter(x => x.s === 'done')
  const fbBlocked = fbStatus.filter(x => x.s === 'blocked')
  const fbMissing = fbStatus.filter(x => x.s === 'missing')
  // Individual battery items carrying a `needs` prerequisite (v0.10.0: the
  // only ones left are WS-064 [kerberos ticket material], WS-065 [human
  // operator], LX-041 [privileged test client]). They execute when the
  // prerequisite is met; the report names the prerequisite so the operator
  // knows exactly what to supply. Nothing is plan-only anymore.
  const fbPlanOnly = selected.flatMap(t =>
    TARGET_PROFILES[t].battery.filter(b => !!b.needs).map(b => `${t}:${b.id} [needs: ${b.needs}]`),
  )
  // v0.18.0 per-item verdicts: the battery may not report complete while any
  // selected item lacks a defensible disposition. Blocked/na items never
  // force extra rounds — they are reported honestly, exactly like cells.
  const lsum = ledgerSummary(ctx.itemLedger)
  const pendingKeys = [...ctx.itemLedger.values()]
    .filter(v => v.disposition === 'pending')
    .map(v => v.key)
  const nonCleanItems = [...ctx.itemLedger.values()].filter(
    v => v.disposition !== 'executed-clean' && v.disposition !== 'pending',
  )
  try {
    writeFileSync(
      join(ctx.events.dir, 'item-verdicts.json'),
      JSON.stringify(serializeLedger(ctx.itemLedger), null, 2),
    )
  } catch {
    /* the ledger lives in memory too — a write failure must never break the report */
  }
  ctx.events.append({
    phase: 'report',
    actor: 'runner',
    action: pendingKeys.length > 0 ? 'battery_incomplete_items' : 'battery_complete_items',
    result:
      `Item reconciliation: ${lsum.total} items — ${lsum.confirmed} confirmed, ${lsum.executedClean} executed-clean, ` +
      `${lsum.killed} killed, ${lsum.blocked} blocked, ${lsum.na} na, ${lsum.pending} pending.` +
      (pendingKeys.length > 0 ? ` NOT COMPLETE: ${pendingKeys.length} items still pending a verdict.` : ''),
  })
  const covered = BATTERY_CATEGORIES.filter(c => ctx.coverage.has(c))
  const batteryLine = ctx.input.fullBattery
    ? `Battery coverage (FULL BATTERY — 3 categories × ${selected.length} targets): ${fbDone.length}/${fbCells.length} cells probed ` +
      `(${batteryStatusLine(ctx)}, ${ctx.probesUsed} probes total). ` +
      (fbBlocked.length > 0
        ? `BLOCKED (prerequisite not met — planned, not probed; see Honest limits): ${fbBlocked.map(({ t, c }) => `${t}:${c}`).join(', ')}. `
        : '') +
      (fbPlanOnly.length > 0
        ? `Items with prerequisites (execute when met — see Honest limits): ${fbPlanOnly.join(', ')}. `
        : '') +
      (fbMissing.length > 0 || pendingKeys.length > 0
        ? `NOT COVERED: ${[
          ...fbMissing.map(({ t, c }) => `${t}:${c}`),
          ...(pendingKeys.length > 0
            ? [
              `${pendingKeys.length} battery items pending a verdict ` +
                    `(${pendingKeys.slice(0, 25).join(', ')}${pendingKeys.length > 25 ? '…' : ''})`,
            ]
            : []),
        ].join('; ')} — list these under Honest limits.`
        : `Full battery complete: all ${fbCells.length} cells probed or honestly blocked; all ${lsum.total} battery items carry a verdict.`)
    : `Battery coverage: ${covered.length}/3 categories probed ` +
      `(${covered.map(c => `${c}:${ctx.coverage.has(c) ? 'yes' : 'no'}`).join(', ')}, ${ctx.probesUsed} probes total). ` +
      (covered.length < 3 ? `NOT COVERED: ${BATTERY_CATEGORIES.filter(c => !ctx.coverage.has(c)).join(', ')} — list these under Honest limits.` : 'Full battery complete.')
  return { fbStatus, fbPlanOnly, lsum, pendingKeys, nonCleanItems, batteryLine }
}
