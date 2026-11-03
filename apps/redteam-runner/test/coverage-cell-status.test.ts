/**
 * Coverage cell status.
 *
 * The defect this pins shut: `targetCellStatus` answered `done` when a single probe
 * had been tagged with the cell's category. The battery has 144 items across a
 * handful of categories, so three requests could satisfy "every cell probed" and the
 * report would claim coverage the engagement never performed. A cell is now `done`
 * only when every item in it carries a settled disposition in the ledger.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TARGET_PROFILES } from '../src/targets/index.js'
import { targetCellStatus, targetItemsFor } from '../src/targets/index.js'
import type { BatteryCategory } from '../src/battery.js'
import type { ItemDisposition, ItemVerdict } from '../src/coverage/items.js'

const PROFILE = TARGET_PROFILES['secscan']!

function firstBusyCategory(): BatteryCategory {
  const categories = [...new Set((PROFILE.battery ?? []).map((b) => b.category))] as BatteryCategory[]
  const busy = categories.find((c) => targetItemsFor(PROFILE, c).length >= 2)
  if (!busy) throw new Error('no category with two or more items to test against')
  return busy
}

function verdict(itemId: string, disposition: ItemDisposition): [string, ItemVerdict] {
  const key = `${PROFILE.id}:${itemId}`
  return [key, {
    key,
    target: PROFILE.id,
    itemId,
    disposition,
  } as unknown as ItemVerdict]
}

describe('coverage cell status is derived from item verdicts', () => {
  it('is not done when only one item in the cell was settled', () => {
    const category = firstBusyCategory()
    const items = targetItemsFor(PROFILE, category)
    const ledger = new Map<string, ItemVerdict>([verdict(items[0]!.id, 'executed-clean')])
    assert.equal(
      targetCellStatus(PROFILE, category, new Set([category]), ledger),
      'missing',
      'one tagged probe satisfied the whole cell',
    )
  })

  it('is done only when every item in the cell is settled', () => {
    const category = firstBusyCategory()
    const items = targetItemsFor(PROFILE, category)
    const ledger = new Map<string, ItemVerdict>(
      items.map((b) => verdict(b.id, 'executed-clean')),
    )
    assert.equal(targetCellStatus(PROFILE, category, new Set(), ledger), 'done')
  })

  it('a single pending item keeps the cell open', () => {
    const category = firstBusyCategory()
    const items = targetItemsFor(PROFILE, category)
    const ledger = new Map<string, ItemVerdict>(items.map((b) => verdict(b.id, 'killed')))
    ledger.set(`${PROFILE.id}:${items[0]!.id}`, {
      ...(ledger.get(`${PROFILE.id}:${items[0]!.id}`)!),
      disposition: 'pending',
    } as ItemVerdict)
    assert.equal(targetCellStatus(PROFILE, category, new Set([category]), ledger), 'missing')
  })

  it('falls back to the category hint when no ledger is supplied', () => {
    const category = firstBusyCategory()
    assert.equal(targetCellStatus(PROFILE, category, new Set([category])), 'done')
    assert.equal(targetCellStatus(PROFILE, category, new Set()), 'missing')
  })
})
