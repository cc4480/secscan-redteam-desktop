/**
 * The compliance section: the engagement's four compliance documents as
 * sub-tabs — Evidence pack, Attestation, Safety manifest, Report.
 *
 * Documents arrive as server-rendered HTML (the console renders its own
 * markdown artifacts). They are shown through the same mechanism the
 * document-preview seat uses for static HTML — an iframe whose srcDoc is
 * the document and whose sandbox is EMPTY (no scripts, no same-origin):
 * engagement-derived content never executes in the app. A document the
 * console has not written shows as a gap, never an invented page.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './locales.ts'
import type { Compliance } from './engagements-model.ts'
import type { SectionState } from './panel-store.ts'
import css from './EngagementsPage.module.css'

/** The four documents, in reading order: key, field, label key. */
const DOCS = [
  { id: 'pack', field: 'packHtml', label: 'compliance.pack' },
  { id: 'attestation', field: 'attestationHtml', label: 'compliance.attestation' },
  { id: 'safety', field: 'safetyHtml', label: 'compliance.safety' },
  { id: 'report', field: 'reportHtml', label: 'compliance.report' },
] as const

type DocId = typeof DOCS[number]['id']

/**
 * Wrap a rendered fragment as a document: documents read as documents
 * (light page, text column) whatever the app's theme.
 * @param html - the server-rendered fragment.
 * @returns a full document string for srcDoc.
 */
function asDocument(t: (key: 'compliance.docOpen' | 'compliance.docClose') => string, html: string): string {
  return `${t('compliance.docOpen')}${html}${t('compliance.docClose')}`
}

/**
 * The compliance section.
 * @param props - the section state and copy.
 * @returns sub-tabs over the sandboxed document frame.
 */
export function ComplianceSection({ section, t }: {
  section: SectionState<Compliance> | undefined
  t: TranslateNS<'redteamConsole'>
}): ReactNode {
  const [doc, setDoc] = useState<DocId>('pack')
  if (section === undefined || section.kind === 'loading') {
    return <p className={css.note}>{t('section.loading')}</p>
  }
  if (section.kind === 'failed') {
    return <p className={css.errorLine}>{t('section.failed', { message: section.message })}</p>
  }
  const compliance = section.value
  const active = DOCS.find(entry => entry.id === doc) ?? DOCS[0]
  const html = compliance[active.field]
  return (
    <div className={css.docWrap}>
      <div className={css.docTabs} role="tablist">
        {DOCS.map(entry => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={doc === entry.id}
            className={clsx(css.docTab, doc === entry.id && css.docTabActive)}
            onClick={() => { setDoc(entry.id) }}
          >
            {t(entry.label)}
          </button>
        ))}
      </div>
      {html === null
        ? <p className={css.note}>{t('compliance.notWritten')}</p>
        : (
          <iframe
            className={css.docFrame}
            title={t(active.label)}
            sandbox=""
            srcDoc={asDocument(t, html)}
          />
        )}
    </div>
  )
}
