/**
 * Incremental append of a live partial onto a settled layout, sharing every
 * unaffected turn and replacing the cells the stream re-emits.
 */
import type { TrajectorySnapshot } from './trajectory-contract.ts'
import type { TrajectoryTranslate } from './locales.ts'
import type { TrajectoryTurnModel } from './layout-types.ts'
import { deriveTrajectoryLayout } from './layout-fold.ts'

/**
 * Append the changing in-flight assistant cells to a stable finalized layout.
 * @param turns - Finalized layout derived with an empty-block partial anchor.
 * @param partial - Current in-flight assistant projection.
 * @param lastIndex - Highest cell index in the finalized layout.
 * @param t - Trajectory locale translator.
 * @returns The original layout without a partial, otherwise a layout sharing every unaffected turn.
 */
export function appendTrajectoryPartialLayout(
  turns: readonly TrajectoryTurnModel[],
  partial: TrajectorySnapshot['partial'],
  lastIndex: number,
  t: TrajectoryTranslate,
): readonly TrajectoryTurnModel[] {
  if (partial === null) return turns
  const partialTurn = deriveTrajectoryLayout({
    nodes: [],
    partial,
    runningCalls: [],
  }, t).at(0)
  if (partialTurn === undefined) return turns
  const streamed: TrajectoryTurnModel = {
    ...partialTurn,
    groups: partialTurn.groups.map(group => ({
      ...group,
      cells: group.cells.map(cell => ({ ...cell, index: cell.index + lastIndex })),
    })),
  }
  const turnIndex = turns.findIndex(turn => turn.turn === streamed.turn)
  if (turnIndex === -1) return [...turns, streamed]
  const current = turns[turnIndex]
  /* v8 ignore next -- findIndex proved the dense array position exists. */
  if (current === undefined) return turns
  const groups = [...current.groups]
  for (const streamedGroup of streamed.groups) {
    const groupIndex = groups.findIndex(group => group.title === streamedGroup.title)
    if (groupIndex === -1) {
      groups.push(streamedGroup)
      continue
    }
    const group = groups[groupIndex]
    /* v8 ignore next -- findIndex proved the dense array position exists. */
    if (group === undefined) continue
    const streamedCallIds = new Set(
      streamedGroup.cells.flatMap(cell => cell.callId === undefined ? [] : [cell.callId]),
    )
    groups[groupIndex] = {
      ...streamedGroup,
      cells: [
        ...group.cells.filter(cell =>
          cell.requestOnly !== true
          && (cell.callId === undefined || !streamedCallIds.has(cell.callId)),
        ),
        ...streamedGroup.cells,
      ],
    }
  }
  const updated = [...turns]
  updated[turnIndex] = { ...current, groups }
  return updated
}
