/**
 * Record body rendering: the markdown fragment, the source block list, the
 * attachment strip, and the assistant tool-call list.
 */
import css from './TrajectoryTable.module.css'
import type { TrajectoryTranslate } from './locales.ts'
import type { TrajectorySourceBlock } from './trajectory-record.ts'
import type { RenderMessageImages } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { useMemo } from 'react'
import {
  FileTypeIcon, IconChevronRightOutlineRegular, MarkdownText, fileExtension,
  fileSizeText,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { markdownLabels } from './trajectory-table-labels.ts'

export function MarkdownFragment({
  text,
  rendered,
  preview,
  variant = 'body',
  t,
}: {
  text: string
  rendered: boolean
  preview: boolean
  variant?: 'body' | 'compact'
  t: TrajectoryTranslate
}) {
  const labels = useMemo(() => markdownLabels(t), [t])
  if (rendered) {
    return (
      <div className={preview ? css.markdownPreview : css.markdownPayload}>
        <MarkdownText text={text} labels={labels} variant={variant} />
      </div>
    )
  }
  return (
    <pre className={`${css.payload} ${preview ? css.payloadPreview : ''}`}>
      {text}
    </pre>
  )
}

export function SourceBlocks({
  blocks,
  onOpenCall,
  t,
}: {
  blocks: readonly TrajectorySourceBlock[]
  onOpenCall: (callId: string) => void
  t: TrajectoryTranslate
}) {
  const attachments = new Map(recordAttachments(blocks, t).map(entry => [entry.index, entry]))
  return (
    <div className={css.sourceBlocks}>
      {blocks.map((block, index) => {
        const attachment = attachments.get(index)
        return attachment !== undefined ? (
          <details className={css.attachmentDisclosure} key={index}>
            <summary>
              <span className={css.sourceBlockLabel}>
                {t('block.label', { index: index + 1, type: block.type })}
              </span>
              <span className={css.attachmentName} title={attachment.name}>
                {attachment.name}
              </span>
            </summary>
            <pre className={css.sourceBlockContent}>{block.content}</pre>
          </details>
        )
          : (
            <section className={css.sourceBlock} key={index}>
              {block.callId !== undefined
                ? (
                  <button
                    type="button"
                    className={css.sourceBlockJumpTarget}
                    aria-label={t('block.openSummary', { index: index + 1 })}
                    title={t('block.openSummaryTitle')}
                    onClick={() => {
                      if (block.callId !== undefined) onOpenCall(block.callId)
                    }}
                  >
                    <span className={css.sourceBlockLabel}>
                      {t('block.label', { index: index + 1, type: block.type })}
                    </span>
                    <IconChevronRightOutlineRegular className={css.sourceBlockJumpIcon} size={12} />
                  </button>
                )
                : (
                  <div className={css.sourceBlockHeader}>
                    <span className={css.sourceBlockLabel}>
                      {t('block.label', { index: index + 1, type: block.type })}
                    </span>
                  </div>
                )}
              <pre className={css.sourceBlockContent}>{block.content}</pre>
            </section>
          )
      })}
    </div>
  )
}

function recordAttachments(
  blocks: readonly TrajectorySourceBlock[] | undefined,
  t: TrajectoryTranslate,
) {
  let imageIndex = 0
  return (blocks ?? []).flatMap((block, index) => {
    const ref = block.attachment ?? block.file
    if (ref === undefined) return []
    if (block.attachment !== undefined) imageIndex += 1
    return [{
      block,
      index,
      name: ref.name ?? t('attachment.imageName', { index: imageIndex }),
      metadata: [
        block.attachment?.mediaType ?? fileExtension(ref.name ?? '').toUpperCase(),
        fileSizeText(ref.bytes),
        ...(block.attachment === undefined ? [] : [`${block.attachment.width} × ${block.attachment.height}`]),
      ].filter(Boolean).join(' · '),
    }]
  })
}

export function RecordAttachments({
  blocks,
  preview,
  renderImages,
  t,
}: {
  blocks: readonly TrajectorySourceBlock[] | undefined
  preview: boolean
  renderImages: RenderMessageImages
  t: TrajectoryTranslate
}) {
  const attachments = recordAttachments(blocks, t)
  if (attachments.length === 0) return null
  return (
    <ul
      className={preview ? `${css.attachments} ${css.attachmentsPreview}` : css.attachments}
      aria-label={t('attachment.list')}
    >
      {attachments.map(({ block, index, name, metadata }) => (
        <li className={css.attachmentRow} key={index}>
          {block.attachment !== undefined
            ? renderImages({
              images: [{ attachment: block.attachment, label: name }],
              align: 'start',
              thumbnail: true,
            })
            : <span className={css.attachmentIcon}><FileTypeIcon path={name} /></span>}
          <div className={css.attachmentInfo}>
            <span className={css.attachmentName} title={name}>{name}</span>
            <span className={css.attachmentMetadata}>{metadata}</span>
          </div>
        </li>
      ))}
    </ul>
  )
}

export function AssistantToolCalls({
  blocks,
  preview,
  onOpenCall,
  t,
}: {
  blocks: readonly TrajectorySourceBlock[] | undefined
  preview: boolean
  onOpenCall: (callId: string) => void
  t: TrajectoryTranslate
}) {
  const calls = blocks?.filter(block => block.type === 'tool-call') ?? []
  if (calls.length === 0) return null
  return (
    <ul className={preview
      ? `${css.assistantToolCalls} ${css.assistantToolCallsPreview}`
      : css.assistantToolCalls}
    >
      {calls.map((call, index) => (
        <li key={call.callId ?? index}>
          <button
            type="button"
            className={css.assistantToolCallButton}
            title={t('block.openSummaryTitle')}
            onClick={() => {
              if (call.callId !== undefined) onOpenCall(call.callId)
            }}
          >
            <svg
              className={css.assistantToolCallIcon}
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className={css.assistantToolCallText}>
              <span className={css.assistantToolCallName}>
                {call.toolName ?? t('details.toolCall')}
              </span>
              {call.content !== '' && (
                <span className={css.assistantToolCallArgs}>{call.content}</span>
              )}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
