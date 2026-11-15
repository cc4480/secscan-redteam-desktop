/**
 * The record presentation cell and its plain-text list rendering.
 */
import css from './TrajectoryTable.module.css'
import type { TrajectoryCellProps } from './trajectory-record.ts'
import type { ReactNode } from 'react'
import type { TrajectoryTranslate } from './locales.ts'
import type { RecordPresentationValue } from './trajectory-table-types.ts'
import { useMemo } from 'react'
import { IconCodeOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  isToolCallOnly, recordDisplayText, recordResultText, toolCallTextParts,
} from './trajectory-table-details.tsx'

export function RecordPresentation({
  cell,
  children,
  t,
}: {
  cell: TrajectoryCellProps
  children: (value: RecordPresentationValue) => ReactNode
  t: TrajectoryTranslate
}) {
  const displayText = useMemo(
    () => recordDisplayText(cell, t),
    [
      cell.kind, cell.text, cell.toolName, cell.previewMarkdown,
      cell.inputDetail, cell.outputDetail, cell.thinkingDetail, t,
    ],
  )
  const resultText = useMemo(
    () => recordResultText(cell),
    [cell.result, cell.resultPreviewMarkdown],
  )
  const toolCallOnly = isToolCallOnly(cell, t)
  const toolCallText = toolCallTextParts(cell, displayText)
  const listDisplayText = toolCallOnly
    ? t('record.toolCallOnly')
    : toolCallText === undefined
      ? displayText
      : [toolCallText.name, toolCallText.args].filter(Boolean).join(' ')
  return children({
    displayText,
    listDisplayText,
    resultText,
    toolCallOnly,
    toolCallText,
  })
}

export function RecordListText({
  displayText,
  toolCallOnly,
  toolCallText,
  t,
}: Pick<RecordPresentationValue, 'displayText' | 'toolCallOnly' | 'toolCallText'> & {
  t: TrajectoryTranslate
}) {
  if (toolCallOnly) {
    return <span className={css.toolCallOnly}>{t('record.toolCallOnly')}</span>
  }
  if (toolCallText === undefined) return displayText || '—'
  return (
    <>
      <span className={css.toolCallNameTypeface}>
        {toolCallText.program && <IconCodeOutlineRegular className={css.programIcon} size={12} />}
        {toolCallText.name || '—'}
      </span>
      {toolCallText.args !== undefined && (
        <span className={toolCallText.program ? css.programSummary : css.toolCallPayload}>
          {toolCallText.args}
        </span>
      )}
    </>
  )
}
