/**
 * Detail-tab selection and record text: which tabs a record offers, its display
 * and result text, its source label, and its parent records.
 */
import css from './TrajectoryTable.module.css'
import type { TrajectoryTranslate } from './locales.ts'
import type { JsonTreeProps } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TrajectoryCellProps } from './trajectory-record.ts'
import type {
  DetailTabItem, ParentRecords, TableRecord, ToolCallTextParts,
} from './trajectory-table-types.ts'
import { JsonTree } from '@deepseek-ai/dsh-client-ui-primitives'
import { PTC_TOOL_NAME, codeProgram } from './code-program.ts'
import { trajectoryPreviewText } from './trajectory-preview.ts'
import { jsonTreeLabels } from './trajectory-table-labels.ts'
import { SYSTEM_PROMPT_TABS, SYSTEM_UPDATE_TABS } from './trajectory-table-constants.ts'

export function messageSourceLabel(source: unknown, t: TrajectoryTranslate): string {
  if (typeof source !== 'object' || source === null || Array.isArray(source)) {
    return t('source.unknown')
  }
  const properties = source as Record<string, unknown>
  const kind = properties.kind
  if (kind === 'user') return t('source.user')
  if (kind === 'goal') {
    const round = properties.round
    return typeof round === 'number' && round > 0
      ? t('source.goalRound', { round })
      : t('source.goal')
  }
  if (typeof kind !== 'string' || kind === '') return t('source.unknown')
  return `${kind[0]?.toUpperCase() ?? ''}${kind.slice(1)}`
}

export function MessageSource({ record, stringWrapping, t }: {
  record: TableRecord
  stringWrapping: JsonTreeProps['stringWrapping']
  t: TrajectoryTranslate
}) {
  const source = record.cell.messageSource
  if (source === undefined) return <p className={css.noPayload}>{t('source.notRecorded')}</p>
  const data = typeof source === 'object' && source !== null
    ? source
    : { value: source }
  return (
    <JsonTree
      data={data}
      stringWrapping={stringWrapping}
      collapsedStringLines={12}
      label={t('source.messageJson')}
      labels={jsonTreeLabels(t)}
      className={css.jsonPayload}
    />
  )
}

export function isMarkdownRecord(record: TableRecord): boolean {
  return record.cell.kind === 'user'
    || record.cell.kind === 'context'
    || record.cell.kind === 'message'
}

export function parentRecords(
  records: readonly TableRecord[],
  record: TableRecord,
): ParentRecords {
  if (record.cell.kind !== 'tool' && record.cell.kind !== 'subtool') return {}
  const at = records.findIndex(candidate => candidate.cell.index === record.cell.index)
  if (at === -1) return {}
  let tool: TableRecord | undefined
  if (record.cell.kind === 'subtool') {
    for (let i = at - 1; i >= 0; i--) {
      const candidate = records[i]
      if (
        candidate === undefined
        || candidate.turn !== record.turn
        || candidate.group !== record.group
      ) break
      if (candidate.cell.kind === 'tool') {
        tool = candidate
        break
      }
    }
  }
  const parentCallId = tool?.cell.callId ?? record.cell.callId
  let message: TableRecord | undefined
  if (parentCallId !== undefined) {
    message = records.find(candidate =>
      candidate.turn === record.turn
      && candidate.cell.kind === 'message'
      && candidate.cell.sourceBlocks?.some(block => block.callId === parentCallId) === true,
    )
  }
  return { ...(message === undefined ? {} : { message }), ...(tool === undefined ? {} : { tool }) }
}

export function markdownSource(record: TableRecord): string | undefined {
  if (record.cell.kind === 'user' || record.cell.kind === 'context') {
    return record.cell.inputDetail
  }
  if (record.cell.kind === 'message' || record.cell.kind === 'compacted') {
    return record.cell.outputDetail
  }
  return undefined
}

export function detailTabs(record: TableRecord): readonly DetailTabItem[] {
  if (record.cell.kind === 'system') {
    if (record.cell.promptDetail === undefined && record.cell.systemPromptDetail !== undefined) {
      return SYSTEM_PROMPT_TABS.filter(tab => tab.id === 'system-prompt')
    }
    return record.cell.previousPromptDetail === undefined
      ? SYSTEM_PROMPT_TABS
      : SYSTEM_UPDATE_TABS
  }
  if (record.cell.kind === 'compacted') {
    return [
      { id: 'overview', labelKey: 'tab.summary' },
      { id: 'raw', labelKey: 'tab.rawOutput' },
    ]
  }
  if (isMarkdownRecord(record)) {
    return [
      { id: 'overview', labelKey: 'tab.summary' },
      { id: 'rendered', labelKey: 'tab.preview' },
      { id: 'raw', labelKey: 'tab.raw' },
      ...(record.cell.messageSource === undefined
        ? []
        : [{ id: 'source', labelKey: 'tab.source' } as const]),
    ]
  }
  return [
    { id: 'overview', labelKey: 'tab.summary' },
    ...(record.cell.inputDetail ? [{
      id: 'input', labelKey: codeProgram(record.cell) === undefined ? 'tab.payload' : 'code.source',
    } as const] : []),
    ...(record.cell.outputDetail || codeProgram(record.cell) !== undefined
      ? [{ id: 'output', labelKey: 'tab.result' } as const] : []),
    { id: 'schema', labelKey: 'tab.schema' },
    { id: 'timing', labelKey: 'tab.timing' },
  ]
}

export function recordDisplayText(cell: TrajectoryCellProps, t: TrajectoryTranslate): string {
  if (isToolCallOnly(cell, t)) return ''
  const program = codeProgram(cell)
  if (program !== undefined) return `${PTC_TOOL_NAME} · ${program.description.replace(/\s+/g, ' ')}`
  if (cell.previewMarkdown !== undefined) {
    const preview = trajectoryPreviewText(cell.previewMarkdown)
    if (cell.text === '') return preview
    return preview === '' ? cell.text : `${cell.text} · ${preview}`
  }
  if (cell.text !== '') return cell.text
  const markdown = cell.kind === 'user' || cell.kind === 'context'
    ? cell.inputDetail
    : cell.kind === 'message'
      ? cell.outputDetail ?? cell.thinkingDetail
      : undefined
  return markdown === undefined ? '' : trajectoryPreviewText(markdown)
}

export function recordResultText(cell: TrajectoryCellProps): string | undefined {
  return cell.resultPreviewMarkdown === undefined
    ? cell.result
    : trajectoryPreviewText(cell.resultPreviewMarkdown)
}

export function toolCallTextParts(
  cell: TrajectoryCellProps,
  text: string,
): ToolCallTextParts | undefined {
  if (cell.kind !== 'tool' && cell.kind !== 'subtool') return undefined
  const program = cell.toolName === PTC_TOOL_NAME
  const separator = text.indexOf(' · ')
  if (separator === -1) return { name: text, program }
  return {
    program,
    name: text.slice(0, separator),
    args: text.slice(separator + 3),
  }
}

export function isToolCallOnly(cell: TrajectoryCellProps, t: TrajectoryTranslate): boolean {
  return cell.kind === 'message'
    && !cell.outputDetail
    && !cell.thinkingDetail
    && cell.text === t('layout.toolCallOnly')
}
