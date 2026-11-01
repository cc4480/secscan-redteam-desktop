/**
 * The Engagements main panel: the console's record, in the chat.
 *
 * A list of every engagement (the A4 console view's fields) beside the
 * selected engagement's record: findings with their proof bundles and
 * per-finding reverify, coverage, and the compliance documents. The panel
 * belongs to the profile, not a session; its controller owns the data,
 * and the page starts/stops it with its own mount so nothing polls while
 * another panel is in front.
 *
 * Content surfaces are solid theme fills — no backdrop-filter anywhere in
 * this panel (the glass guardrail: blur is container chrome only).
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from './locales.ts'
import { ComplianceSection } from './ComplianceSection.tsx'
import { CoverageSection } from './CoverageSection.tsx'
import { FindingsSection } from './FindingsSection.tsx'
import { formatDateTime, formatDuration } from './format.ts'
import type { ConsoleEngagement } from './model.ts'
import type { EngagementsInjected } from './panel-face.ts'
import css from './EngagementsPage.module.css'

/** The page's composed props: the main-slot runtime, the panel face, and copy. */
export type EngagementsPageProps =
  & PropsRuntime<'main'>
  & PropsLocale<'redteamConsole'>
  & InjectFace<EngagementsInjected>

/** The record sections, in reading order. */
const SECTIONS = [
  { id: 'findings', label: 'sec.findings' },
  { id: 'coverage', label: 'sec.coverage' },
  { id: 'compliance', label: 'sec.compliance' },
] as const

type SectionId = typeof SECTIONS[number]['id']

/** Engagement status → its chip accent class. */
function statusClass(status: string): string {
  if (status === 'running') return css.st_running ?? ''
  if (status === 'complete') return css.st_complete ?? ''
  if (status === 'halted' || status === 'blocked') return css.st_halted ?? ''
  return css.st_other ?? ''
}

/** One list row: an engagement's identity and headline numbers. */
function EngagementRow({ engagement, selected, onSelect }: {
  engagement: ConsoleEngagement
  selected: boolean
  onSelect: () => void
}): ReactNode {
  return (
    <button
      type="button"
      className={clsx(css.listRow, selected && css.listRowSelected)}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <span className={css.listRowTop}>
        <span className={clsx(css.statusChip, statusClass(engagement.status))}>{engagement.status}</span>
        <span className={css.mono}>{engagement.id}</span>
      </span>
      <span className={css.listTarget}>{engagement.target}</span>
      <span className={css.listMeta}>
        {`${engagement.phase} · ${engagement.findings.proven}/${engagement.findings.total}`}
        {engagement.tokens !== null && ` · ${engagement.tokens.total.toLocaleString()}`}
      </span>
    </button>
  )
}

/** The Engagements page: list beside record. */
export function EngagementsPage(props: EngagementsPageProps): ReactNode {
  const { useEngagements, start, stop, refresh, select, loadProof, planReverify, executeReverify, t } = props
  const state = useEngagements(snapshot => snapshot)
  const [section, setSection] = useState<SectionId>('findings')
  useEffect(() => {
    start()
    return () => { stop() }
  }, [start, stop])

  const selected = state.list.kind === 'ready'
    ? state.list.engagements.find(entry => entry.id === state.selectedId)
    : undefined
  return (
    <div className={css.root} role="region" aria-label={t('panel.aria')}>
      <div className={css.listCol}>
        <div className={css.listHead}>
          <h2 className={css.title}>{t('panel.title')}</h2>
          <button type="button" className={css.button} onClick={() => { refresh() }}>{t('panel.refresh')}</button>
        </div>
        {state.list.kind === 'loading' && <p className={css.note}>{t('panel.loading')}</p>}
        {state.list.kind === 'failed' && (
          <p className={css.errorLine}>{t('panel.failed', { message: state.list.message })}</p>
        )}
        {state.list.kind === 'ready' && !state.list.available && (
          <p className={css.note}>{t('panel.unavailable', { reason: state.list.reason ?? '' })}</p>
        )}
        {state.list.kind === 'ready' && state.list.available && state.list.engagements.length === 0 && (
          <p className={css.note}>{t('panel.empty')}</p>
        )}
        {state.list.kind === 'ready' && state.list.available && (
          <div className={css.listScroll}>
            {state.list.engagements.map(engagement => (
              <EngagementRow
                key={engagement.id}
                engagement={engagement}
                selected={engagement.id === state.selectedId}
                onSelect={() => { select(engagement.id) }}
              />
            ))}
          </div>
        )}
      </div>
      <div className={css.detailCol}>
        {selected === undefined
          ? <p className={css.note}>{t('panel.empty')}</p>
          : (
            <>
              <header className={css.detailHead}>
                <span className={clsx(css.statusChip, statusClass(selected.status))}>{selected.status}</span>
                <span className={css.mono}>{selected.id}</span>
                <span className={css.listTarget}>{selected.target}</span>
                <span className={css.listMeta}>
                  {`${selected.mode} · ${formatDateTime(selected.startedAt)}`}
                  {selected.durationMs !== null && ` · ${formatDuration(t, selected.durationMs)}`}
                  {selected.tokens !== null && ` · ${selected.tokens.total.toLocaleString()}`}
                  {selected.steps !== null && ` · ${selected.steps}`}
                </span>
              </header>
              <div className={css.sectionTabs} role="tablist">
                {SECTIONS.map(entry => (
                  <button
                    key={entry.id}
                    type="button"
                    role="tab"
                    aria-selected={section === entry.id}
                    className={clsx(css.tabBtn, section === entry.id && css.tabBtnActive)}
                    onClick={() => { setSection(entry.id) }}
                  >
                    {t(entry.label)}
                  </button>
                ))}
              </div>
              <div className={css.detailScroll}>
                {section === 'findings' && (
                  <FindingsSection
                    section={state.findings}
                    proofByFinding={state.proofByFinding}
                    reverifyByFinding={state.reverifyByFinding}
                    target={selected.target}
                    face={{ loadProof, planReverify, executeReverify }}
                    t={t}
                  />
                )}
                {section === 'coverage' && <CoverageSection section={state.coverage} t={t} />}
                {section === 'compliance' && <ComplianceSection section={state.compliance} t={t} />}
              </div>
            </>
          )}
      </div>
    </div>
  )
}
