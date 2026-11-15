/**
 * Turn model assembly from the fold's laid groups: group descriptions and the
 * chronological key used to order turns.
 */
import type { TrajectoryTranslate } from './locales.ts'
import type { TrajectoryGroupModel, TrajectoryTurnModel, TurnBucket } from './layout-types.ts'
import { groupDescription } from './layout-time.ts'

export function toTurnModel(
  turn: number | null,
  entry: TurnBucket,
  t: TrajectoryTranslate,
): TrajectoryTurnModel {
  const groups = entry.groups.map(({ title, laid }): TrajectoryGroupModel => {
    const description = groupDescription(laid, t)
    return {
      title,
      ...(description !== undefined ? { description } : {}),
      cells: laid.map(l => l.cell),
    }
  })
  return { turn, groups }
}

/** Chronological section position from the fold's monotonically assigned cell indexes. */
export function firstCellIndex(turn: TrajectoryTurnModel): number {
  return Math.min(
    ...turn.groups.flatMap(group => group.cells.map(cell => cell.index)),
    Number.POSITIVE_INFINITY,
  )
}
