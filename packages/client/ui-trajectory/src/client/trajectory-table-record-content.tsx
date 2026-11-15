/**
 * Markdown record content with its collapsible chrome, and the record and
 * request timing strips.
 */
import css from './TrajectoryTable.module.css'
import type { RenderMessageImages } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TrajectoryTranslate } from './locales.ts'
import type { TableRecord, TrajectoryRequestNumber } from './trajectory-table-types.ts'
import { IconChevronRightOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { formatElapsedSeconds } from './trajectory-record.ts'
import {
  AssistantToolCalls, MarkdownFragment, RecordAttachments, SourceBlocks,
} from './trajectory-table-content.tsx'
import { isToolCallOnly, markdownSource } from './trajectory-table-details.tsx'
import { AssistantTimingPanel, StartedAtValue } from './trajectory-table-timing.tsx'

export function MarkdownRecordContent({
  record,
  rendered,
  preview = false,
  thinkingExpanded,
  onThinkingExpandedChange,
  onOpenCall,
  renderImages,
  t,
}: {
  record: TableRecord
  rendered: boolean
  preview?: boolean
  thinkingExpanded: boolean
  onThinkingExpandedChange: (expanded: boolean) => void
  onOpenCall: (callId: string) => void
  renderImages: RenderMessageImages
  t: TrajectoryTranslate
}) {
  if (!rendered && record.cell.sourceBlocks && record.cell.sourceBlocks.length > 0) {
    return (
      <SourceBlocks
        blocks={record.cell.sourceBlocks}
        onOpenCall={onOpenCall}
        t={t}
      />
    )
  }
  if (record.cell.thinkingDetail) {
    if (!rendered) {
      const source = [
        record.cell.thinkingDetail,
        record.cell.outputDetail,
      ].filter((value): value is string => value !== undefined && value !== '').join('\n\n')
      return <MarkdownFragment text={source} rendered={false} preview={preview} t={t} />
    }
    return (
      <div className={`${css.assistantContent} ${css.assistantContentRendered}`}>
        <div className={
          preview && !record.cell.outputDetail
            ? `${css.thinkingQuote} ${css.thinkingQuoteOnlyPreview}`
            : css.thinkingQuote
        }
        >
          <button
            type="button"
            className={css.thinkingToggle}
            aria-expanded={thinkingExpanded}
            onClick={() => { onThinkingExpandedChange(!thinkingExpanded) }}
          >
            {t('record.thinking')}
            <IconChevronRightOutlineRegular className={css.thinkingChevron} size={12} />
          </button>
          {thinkingExpanded && (
            <MarkdownFragment
              text={record.cell.thinkingDetail}
              rendered={rendered}
              preview={preview}
              variant="compact"
              t={t}
            />
          )}
        </div>
        {record.cell.outputDetail && (
          <div className={css.assistantOutput}>
            <MarkdownFragment
              text={record.cell.outputDetail}
              rendered={rendered}
              preview={preview}
              t={t}
            />
          </div>
        )}
        <AssistantToolCalls
          blocks={record.cell.sourceBlocks}
          preview={preview}
          onOpenCall={onOpenCall}
          t={t}
        />
        <RecordAttachments
          blocks={record.cell.sourceBlocks}
          preview={preview}
          renderImages={renderImages}
          t={t}
        />
      </div>
    )
  }
  const source = markdownSource(record)
  const hasAttachments = record.cell.sourceBlocks?.some(block => block.attachment !== undefined || block.file !== undefined) === true
  const hasToolCalls = record.cell.kind === 'message'
    && record.cell.sourceBlocks?.some(block => block.type === 'tool-call') === true
  if (!source && !hasAttachments && !hasToolCalls) {
    const emptyLabel = isToolCallOnly(record.cell, t)
      ? t('record.toolCallOnly')
      : record.cell.text || t('record.noContent')
    return <p className={css.noPayload}>{emptyLabel}</p>
  }
  if (!rendered || (!hasAttachments && !hasToolCalls)) {
    return <MarkdownFragment text={source ?? ''} rendered={rendered} preview={preview} t={t} />
  }
  return (
    <div>
      {source && <MarkdownFragment text={source} rendered preview={preview} t={t} />}
      {record.cell.kind === 'message' && (
        <AssistantToolCalls
          blocks={record.cell.sourceBlocks}
          preview={preview}
          onOpenCall={onOpenCall}
          t={t}
        />
      )}
      <RecordAttachments blocks={record.cell.sourceBlocks} preview={preview} renderImages={renderImages} t={t} />
    </div>
  )
}

export function RecordTiming({
  record,
  preview = false,
  t,
}: { record: TableRecord; preview?: boolean; t: TrajectoryTranslate }) {
  return record.cell.kind === 'message' && record.cell.assistantMetrics !== undefined
    ? <AssistantTimingPanel metrics={record.cell.assistantMetrics} t={t} />
    : (
      <dl className={css.overview}>
        <div><dt>{t('timing.started')}</dt><StartedAtValue timestamp={record.cell.startedAt ?? null} t={t} /></div>
        <div><dt>{t('timing.duration')}</dt><dd>{formatElapsedSeconds(record.cell.timeSeconds, t)}</dd></div>
        {!preview && (
          <div><dt>{t('timing.source')}</dt><dd>{record.cell.timeSeconds === null ? t('timing.notAvailable') : t('timing.sessionTimestamps')}</dd></div>
        )}
      </dl>
    )
}

export function RequestTiming({
  assistant,
  anchor,
  request,
  preview = false,
  t,
}: {
  assistant: TableRecord | undefined
  anchor: TableRecord | undefined
  request: TrajectoryRequestNumber | undefined
  preview?: boolean
  t: TrajectoryTranslate
}) {
  if (assistant !== undefined) return <RecordTiming record={assistant} preview={preview} t={t} />
  if (request?.startedAt !== undefined) {
    const duration = request.completedAt === null || request.completedAt === undefined
      ? null
      : Math.max(0, (request.completedAt - request.startedAt) / 1000)
    return (
      <dl className={css.overview}>
        <div><dt>{t('timing.started')}</dt><StartedAtValue timestamp={request.startedAt} t={t} /></div>
        <div><dt>{t('timing.duration')}</dt><dd>{formatElapsedSeconds(duration, t)}</dd></div>
        {!preview && (
          <div>
            <dt>{t('timing.source')}</dt>
            <dd>{duration === null ? t('timing.sessionTimestampsRunning') : t('timing.sessionTimestamps')}</dd>
          </div>
        )}
      </dl>
    )
  }
  return (
    <dl className={css.overview}>
      <div>
        <dt>{t('timing.started')}</dt>
        <StartedAtValue timestamp={anchor?.cell.startedAt ?? null} t={t} />
      </div>
      <div><dt>{t('timing.duration')}</dt><dd>{formatElapsedSeconds(null, t)}</dd></div>
    </dl>
  )
}
