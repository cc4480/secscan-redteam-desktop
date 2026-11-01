/**
 * The Reports library: every engagement's autofire deliverable set, as
 * documents with actions — the canonical seven files in package order,
 * Copy on the text formats, Download on everything present, and files
 * the record does not name shown as gaps, never invented. Presence
 * derives from the completion record itself (`state.deliverables` on
 * the detail route); the bytes ride the runner's deliverable route
 * through the Phase 0 proxy.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  DELIVERABLE_FILE_NAMES, isCopyableDeliverable, type DeliverableFileName,
} from '@secscan/redteam-console-share/shared'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from './locales.ts'
import type { ReportsInjected } from './arsenal-face.ts'
import { copyDeliverable, downloadDeliverable } from './documents.ts'
import type { EngagementDetail } from './library-model.ts'
import type { ReportsPanelState } from './library-store.ts'
import type { SectionState } from './panel-store.ts'
import css from './LibraryPages.module.css'

/** The page's composed props. */
export type ReportsPageProps =
  & PropsRuntime<'main'>
  & PropsLocale<'redteamConsole'>
  & InjectFace<ReportsInjected>

type T = ReportsPageProps['t']

type Feedback = { readonly file: DeliverableFileName; readonly kind: 'copied' | 'copyFailed' | 'downloadFailed' } | undefined

/** One deliverable row: present with actions, or a named gap. */
function DeliverableRow({ id, file, present, feedback, onFeedback, t }: {
  id: string
  file: DeliverableFileName
  present: boolean
  feedback: Feedback
  onFeedback: (feedback: Feedback) => void
  t: T
}): ReactNode {
  if (!present) {
    return (
      <li className={`${css.docRow} ${css.gapRow}`}>
        <span className={css.docName}>{file}</span>
        <span className={css.rowMeta}>{t('reports.missing')}</span>
      </li>
    )
  }
  const mine = feedback?.file === file ? feedback : undefined
  const copyable = isCopyableDeliverable(file)
  return (
    <li className={css.docRow}>
      <span className={css.docName}>{file}</span>
      {copyable
        ? (
          <button
            type="button"
            className={css.button}
            onClick={() => {
              void copyDeliverable(id, file).then(ok => onFeedback({ file, kind: ok ? 'copied' : 'copyFailed' }))
            }}
          >
            {mine?.kind === 'copied' ? t('reports.copied') : t('reports.copy')}
          </button>
        )
        : <span className={css.rowMeta}>{t('reports.binaryNote')}</span>}
      <button
        type="button"
        className={css.button}
        onClick={() => {
          void downloadDeliverable(id, file).then(ok => onFeedback(ok ? undefined : { file, kind: 'downloadFailed' }))
        }}
      >
        {file === 'report-package.zip' ? t('reports.downloadAll') : t('reports.download')}
      </button>
      {mine?.kind === 'copyFailed' && <span className={css.errorLine}>{t('reports.copyFailed')}</span>}
      {mine?.kind === 'downloadFailed' && <span className={css.errorLine}>{t('reports.downloadFailed')}</span>}
    </li>
  )
}

/** The selected engagement's deliverable set. */
function Deliverables({ id, detail, t }: {
  id: string
  detail: SectionState<EngagementDetail> | undefined
  t: T
}): ReactNode {
  const [feedback, setFeedback] = useState<Feedback>(undefined)
  if (detail === undefined || detail.kind === 'loading') {
    return <p className={css.note}>{t('reports.loading')}</p>
  }
  if (detail.kind === 'failed') {
    return <p className={css.errorLine}>{t('reports.failed', { message: detail.message })}</p>
  }
  const { state } = detail.value
  if (state === null || detail.value.pending === true) {
    return <p className={css.note}>{t('reports.pending')}</p>
  }
  const record = state.deliverables
  if (record === undefined) {
    return <p className={css.note}>{t('reports.noDeliverables')}</p>
  }
  return (
    <>
      {state.deliverableFailed === true && <p className={css.errorLine}>{t('reports.failedNote')}</p>}
      <ul className={css.list}>
        {DELIVERABLE_FILE_NAMES.map(file => (
          <DeliverableRow
            key={file}
            id={id}
            file={file}
            present={record[file] !== undefined}
            feedback={feedback}
            onFeedback={setFeedback}
            t={t}
          />
        ))}
      </ul>
    </>
  )
}

/**
 * The Reports library page.
 * @param props - the main-slot runtime, the panel face, and copy.
 * @returns the panel.
 */
export function ReportsPage(props: ReportsPageProps): ReactNode {
  const { useReports, start, stop, refresh, select, t } = props
  const state: ReportsPanelState = useReports(s => s)
  useEffect(() => {
    start()
    return () => { stop() }
  }, [start, stop])
  return (
    <div className={css.page}>
      <div className={css.head}>
        <h2 className={css.title}>{t('reports.title')}</h2>
        <div className={css.actions}>
          <button type="button" className={css.button} onClick={() => { refresh() }}>
            {t('reports.refresh')}
          </button>
        </div>
      </div>
      <div className={css.twoCol}>
        <div className={css.listCol}>
          {state.list.kind === 'loading' && <p className={css.note}>{t('reports.loading')}</p>}
          {state.list.kind === 'failed' && (
            <p className={css.errorLine}>{t('reports.failed', { message: state.list.message })}</p>
          )}
          {state.list.kind === 'ready' && state.list.engagements.length === 0 && (
            <p className={css.note}>{t('reports.empty')}</p>
          )}
          {state.list.kind === 'ready' && (
            <ul className={css.list}>
              {state.list.engagements.map(engagement => (
                <li key={engagement.id}>
                  <button
                    type="button"
                    className={css.topicButton}
                    aria-pressed={engagement.id === state.selectedId}
                    onClick={() => { select(engagement.id) }}
                  >
                    <span className={css.rowName}>{engagement.target}</span>
                    <span className={css.rowMeta}>
                      {engagement.status} · <span className={css.mono}>{engagement.id}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className={css.detailCol}>
          {state.selectedId !== undefined && (
            <Deliverables key={state.selectedId} id={state.selectedId} detail={state.detail} t={t} />
          )}
        </div>
      </div>
    </div>
  )
}
