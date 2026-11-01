/** The engagement_report tool row: the finished report's document card with Copy/Download actions. */
import { useState } from 'react'
import {
  DisclosureRow, IconCheckOutlineRegular, IconCopyOutlineRegular, IconDeliverDocRegular, IconDownloadOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  createEngagementDocumentActions, engagementDocumentsFromResult,
  type EngagementDocument, type EngagementDocumentActions,
} from './engagement-documents.ts'
import type { NS } from './locales.ts'
import css from './EngagementReportRow.module.css'

/* v8 ignore next -- Non-expandable rows never invoke DisclosureRow's required toggle callback. */
const noop = (): void => undefined

type RowProps = ToolCallViewProps & PropsLocale<typeof NS> & {
  /** Document actions override, supplied by tests; production uses the share-route actions. */
  actions?: EngagementDocumentActions
}

/** Settled result text of a tool call block, joining its text items like the generic rows do. */
function resultText(props: ToolCallViewProps): string {
  return 'kind' in props.block
    ? props.block.content.map(item => item.type === 'text' ? item.text : JSON.stringify(item)).join('\n')
    : ''
}

/**
 * Render an engagement_report call. A ready report becomes the document
 * card: every deliverable of the closing set with its Copy/Download
 * actions, missing files as labelled gaps with no actions, and a
 * Download-all on the package zip's row. A report that is not ready yet
 * (or a result this card cannot parse) keeps the plain status summary.
 * @param props - tool call, localized copy, and optional action override.
 * @returns the report row.
 */
export function EngagementReportRow(props: RowProps) {
  // The document card starts expanded: the documents are the point of the row.
  const [expanded, setExpanded] = useState(true)
  if (props.phase === 'preparing') {
    return <div data-tool="engagement_report" data-state="preparing" aria-label={props.t('engagement.preparing')}>
      <DisclosureRow title={props.t('engagement.title')} icon={<IconDeliverDocRegular size={14} />}
        open={false} expandable={false} onToggle={noop} running />
    </div>
  }
  const report = props.phase === 'result' ? engagementDocumentsFromResult(resultText(props)) : null
  if (report === null) {
    const settled = 'kind' in props.block
    const state = !settled ? 'running' : props.block.isError ? 'error' : 'ok'
    return <div data-tool="engagement_report" data-state={state}>
      <DisclosureRow title={props.t('engagement.title')} icon={<IconDeliverDocRegular size={14} />}
        open={false} expandable={false} onToggle={noop} running={!settled}>
        <span className={css.summary}>{props.t(`engagement.${state}`)}</span>
      </DisclosureRow>
    </div>
  }
  const actions = props.actions ?? createEngagementDocumentActions(report.id)
  return <div data-tool="engagement_report" data-state="ok">
    <DisclosureRow title={props.t('engagement.title')} icon={<IconDeliverDocRegular size={14} />}
      open={expanded} expandable onToggle={() => { setExpanded(value => !value) }}>
      <div className={css.documents} data-engagement-documents>
        {report.documents.map(document => <DocumentRow key={document.file} document={document} actions={actions} t={props.t} />)}
      </div>
    </DisclosureRow>
  </div>
}

/** One deliverable's row: name, format note, and its actions — or its gap label. */
function DocumentRow({ document, actions, t }: {
  document: EngagementDocument
  actions: EngagementDocumentActions
} & PropsLocale<typeof NS>) {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState<'copy' | 'download' | null>(null)
  if (!document.present) {
    return <div className={css.document} data-document={document.file} data-gap>
      <span className={css.fileName}>{document.file}</span>
      <span className={css.gap}>{t('engagement.missing')}</span>
    </div>
  }
  const isPackage = document.file === 'report-package.zip'
  const onDownload = (): void => {
    setFailed(null)
    void actions.download(document.file).then((ok) => { if (!ok) setFailed('download') })
  }
  const onCopy = (): void => {
    setFailed(null)
    void actions.copy(document.file).then((text) => {
      if (text === null) { setFailed('copy'); return }
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1000)
    })
  }
  return <div className={css.document} data-document={document.file}>
    <span className={css.fileName}>{document.file}</span>
    {!document.copyable && <span className={css.note}>{t('engagement.downloadOnly')}</span>}
    {failed !== null && <span className={css.error} role="status">{t(failed === 'copy' ? 'engagement.copyFailed' : 'engagement.downloadFailed')}</span>}
    <span className={css.actions}>
      {document.copyable && <button type="button" className={css.action} onClick={onCopy}
        aria-label={t(copied ? 'engagement.copied' : 'engagement.copy', { name: document.file })}>
        {copied ? <IconCheckOutlineRegular size={14} /> : <IconCopyOutlineRegular size={14} />}
        <span>{t(copied ? 'engagement.copied' : 'engagement.copyLabel')}</span>
      </button>}
      <button type="button" className={css.action} onClick={onDownload}
        aria-label={t(isPackage ? 'engagement.downloadAll' : 'engagement.download', { name: document.file })}>
        <IconDownloadOutlineRegular size={14} />
        <span>{t(isPackage ? 'engagement.downloadAllLabel' : 'engagement.downloadLabel')}</span>
      </button>
    </span>
  </div>
}
