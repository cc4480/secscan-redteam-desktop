/**
 * Turn and assistant collapse summaries: the metrics a collapsed turn shows and
 * the tool histogram an assistant row summarises.
 */
import type { TrajectoryTranslate } from './locales.ts'
import type { RecordState, TableRecord, TrajectoryRequestNumber } from './trajectory-table-types.ts'
import { trajectoryRecordId } from './trajectory-record.ts'
import { COMPACTION_INTERRUPTED_ERROR } from './copy-codes.ts'
import { requestKey } from './trajectory-table-rows.ts'

function summarizeTurn(
  records: readonly TableRecord[],
  requestGroups: ReadonlySet<string>,
  t: TrajectoryTranslate,
): string {
  const steps = new Set(
    records
      .map(record => requestKey(record.turn, record.group))
      .filter(key => requestGroups.has(key)),
  ).size
  const toolCalls = records.filter(record =>
    record.cell.kind === 'tool' || record.cell.kind === 'subtool',
  ).length
  return [
    t(steps === 1 ? 'summary.steps.one' : 'summary.steps.other', { count: steps }),
    t(toolCalls === 1 ? 'summary.toolCalls.one' : 'summary.toolCalls.other', {
      count: toolCalls,
    }),
  ].join(' · ')
}

export function collapseTurnRecords(
  records: readonly TableRecord[],
  collapsedTurns: ReadonlySet<number>,
  requestGroups: ReadonlySet<string>,
  t: TrajectoryTranslate,
): TableRecord[] {
  const recordsByTurn = new Map<number, TableRecord[]>()
  for (const record of records) {
    if (record.turn === null) continue
    const turnRecords = recordsByTurn.get(record.turn) ?? []
    turnRecords.push(record)
    recordsByTurn.set(record.turn, turnRecords)
  }
  return records.flatMap((record) => {
    if (record.turn === null || !collapsedTurns.has(record.turn)) return [record]
    const turnRecords = recordsByTurn.get(record.turn) ?? [record]
    if (record.cell.requestOnly === true || record.cell.kind === 'system') return [record]
    const contentRecords = turnRecords.filter(candidate =>
      candidate.cell.requestOnly !== true && candidate.cell.kind !== 'system')
    if (contentRecords.length <= 1) return [record]
    if (record.cell.index !== contentRecords[0]?.cell.index) return []
    return [
      { ...record, turnEnd: false },
      {
        ...record,
        groupStart: false,
        turnStart: false,
        turnEnd: true,
        collapsedSummary: summarizeTurn(contentRecords.slice(1), requestGroups, t),
        collapsedSummaryKind: 'turn',
      },
    ]
  })
}

export function assistantToolCalls(
  records: readonly TableRecord[],
  assistantIndex: number,
): readonly TableRecord[] {
  const at = records.findIndex(record => record.cell.index === assistantIndex)
  if (at === -1 || records[at]?.cell.kind !== 'message') return []
  const calls: TableRecord[] = []
  for (let i = at + 1; i < records.length; i++) {
    const record = records[i]
    if (record === undefined) break
    if (record.cell.kind !== 'tool' && record.cell.kind !== 'subtool') break
    calls.push(record)
  }
  return calls
}

function summarizeAssistantTools(
  records: readonly TableRecord[],
  t: TrajectoryTranslate,
): string {
  const names = [...new Set(records.map((record) => {
    const separator = record.cell.text.indexOf(' · ')
    return separator === -1 ? record.cell.text : record.cell.text.slice(0, separator)
  }).filter(name => name !== ''))]
  const count = records.length
  const summary = t(count === 1 ? 'summary.toolCalls.one' : 'summary.toolCalls.other', { count })
  return names.length > 0 ? `${summary} · ${names.join(', ')}` : summary
}

export function collapseAssistantRecords(
  records: readonly TableRecord[],
  collapsedAssistants: ReadonlySet<string>,
  t: TrajectoryTranslate,
): TableRecord[] {
  const out: TableRecord[] = []
  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    if (record === undefined) continue
    out.push(record)
    if (
      record.cell.kind !== 'message'
      || !collapsedAssistants.has(trajectoryRecordId(record.cell))
    ) continue
    const calls: TableRecord[] = []
    for (let j = i + 1; j < records.length; j++) {
      const candidate = records[j]
      if (
        candidate === undefined
        || candidate.collapsedSummary !== undefined
        || (candidate.cell.kind !== 'tool' && candidate.cell.kind !== 'subtool')
      ) break
      calls.push(candidate)
    }
    if (calls.length === 0) continue
    const last = calls.at(-1)
    out[out.length - 1] = { ...record, turnEnd: false }
    out.push({
      ...record,
      groupStart: false,
      turnStart: false,
      turnEnd: last?.turnEnd ?? false,
      collapsedSummary: summarizeAssistantTools(calls, t),
      collapsedSummaryKind: 'assistant',
    })
    i += calls.length
  }
  return out
}

export function stateOf(record: TableRecord): RecordState {
  if (record.cell.isError) return 'error'
  if (record.cell.kind === 'compacted' && record.cell.timeSeconds === null) return 'running'
  if (
    (record.cell.kind === 'tool' || record.cell.kind === 'subtool')
    && record.cell.outputDetail === undefined
  ) return 'running'
  return 'complete'
}

export function statusLabel(state: RecordState, t: TrajectoryTranslate): string {
  if (state === 'error') return t('status.failed')
  if (state === 'running') return t('status.pending')
  return t('status.completed')
}

export function requestErrorMessage(
  request: Pick<TrajectoryRequestNumber, 'error' | 'errorCode'>,
  t: TrajectoryTranslate,
): string | undefined {
  if (request.errorCode === 'AUTH') return t('details.failure.auth')
  if (request.error === COMPACTION_INTERRUPTED_ERROR) return t('layout.compactionInterrupted')
  return request.error
}
