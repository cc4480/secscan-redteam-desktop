/**
 * Turn/group cells flattened into table records, the search filter, and the
 * request boundary and number indexes the boundary rows render from.
 */
import type { TrajectoryVirtualRow } from './trajectory-virtual-rows.ts'
import type { TrajectoryTurnModel } from './layout.ts'
import type { TrajectoryTranslate } from './locales.ts'
import type {
  TableRecord, TrajectoryRequestNumber, VirtualRowStructure,
} from './trajectory-table-types.ts'
import { useRef } from 'react'

export function useStableVirtualRowStructure(
  rows: readonly TrajectoryVirtualRow<TableRecord>[],
): readonly VirtualRowStructure[] {
  const cache = useRef<{
    rows: readonly TrajectoryVirtualRow<TableRecord>[]
    structure: readonly VirtualRowStructure[]
  }>({ rows: [], structure: [] })
  if (cache.current.rows === rows) return cache.current.structure
  const structure = cache.current.structure.length === rows.length
    && rows.every((row, index) => {
      const previous = cache.current.structure[index]
      return previous?.key === row.key && previous.height === row.height
    })
    ? cache.current.structure
    : rows.map(row => ({ key: row.key, height: row.height }))
  cache.current = { rows, structure }
  return structure
}

export function flattenRecords(turns: readonly TrajectoryTurnModel[]): TableRecord[] {
  return turns.flatMap((turn, section) => {
    let firstInSection = true
    const records = turn.groups.flatMap((group) => {
      return group.cells.map((cell, index) => {
        const turnStart = firstInSection
          && cell.requestOnly !== true
          && cell.kind !== 'system'
          && (cell.kind !== 'compacted' || turn.turn === null)
        if (turnStart) firstInSection = false
        return {
          turn: turn.turn,
          section,
          group: group.title,
          groupStart: index === 0,
          turnStart,
          cell,
          turnEnd: false,
        }
      })
    })
    const last = records.at(-1)
    if (last !== undefined) last.turnEnd = true
    return records
  })
}

export function filterRecords(
  records: readonly TableRecord[],
  matches: ReadonlySet<number>,
): TableRecord[] {
  const filtered = records
    .filter(record =>
      record.cell.requestOnly !== true && matches.has(record.cell.index),
    )
    .map(record => ({ ...record, groupStart: false, turnStart: false, turnEnd: false }))
  const startedSections = new Set<number>()
  for (const [index, record] of filtered.entries()) {
    const previous = filtered[index - 1]
    const next = filtered[index + 1]
    record.groupStart = previous === undefined
      || previous.section !== record.section
      || previous.group !== record.group
    record.turnStart = !startedSections.has(record.section)
      && record.cell.kind !== 'system'
      && (record.cell.kind !== 'compacted' || record.turn === null)
    if (record.turnStart) startedSections.add(record.section)
    record.turnEnd = next === undefined || next.section !== record.section
  }
  return filtered
}

export function requestKey(turn: number | null, group: string): string {
  return `${turn}\u0000${group}`
}

export function requestIdentity(request: TrajectoryRequestNumber): string {
  return request.purpose === 'compaction'
    ? `compaction\u0000${request.seq}`
    : `assistant\u0000${request.turn}\u0000${request.step}`
}

export function indexRequestBoundaries(
  records: readonly TableRecord[],
  requestGroups: ReadonlySet<string>,
): ReadonlyMap<string, number> {
  const boundaries = new Map<string, number>()
  for (const record of records) {
    const key = requestKey(record.turn, record.group)
    if (!requestGroups.has(key)) continue
    if (boundaries.has(key)) continue
    if (record.cell.kind === 'user' || record.cell.kind === 'context') continue
    boundaries.set(key, record.cell.index)
  }
  return boundaries
}

export function sectionLabel(turn: number | null, t: TrajectoryTranslate): string {
  return turn === null ? t('section.betweenTurns') : t('turn.label', { turn })
}

export function indexRequestNumbers(
  sessionNumbers: readonly TrajectoryRequestNumber[] | undefined,
): ReadonlyMap<string, number> {
  const numbers = new Map<string, number>()
  for (const request of sessionNumbers ?? []) {
    numbers.set(requestKey(request.turn, request.group), request.number)
  }
  return numbers
}

export function indexRequestBoundaryRuns(
  records: readonly TableRecord[],
  requestGroups: ReadonlySet<string>,
): ReadonlyMap<number, number> {
  const indexes = new Map<number, number>()
  let runLength = 0
  for (const record of records) {
    if (record.cell.requestOnly === true) {
      indexes.set(record.cell.index, runLength++)
      continue
    }
    if (
      runLength > 0
      && record.groupStart
      && requestGroups.has(requestKey(record.turn, record.group))
    ) {
      indexes.set(record.cell.index, runLength)
    }
    runLength = 0
  }
  return indexes
}
