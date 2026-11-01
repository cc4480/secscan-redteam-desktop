/**
 * The Scope & Safety main panel: the cross-engagement aggregate from
 * the console (denial/halt totals, halt-reason classes, per-engagement
 * rows, the latest scope events) — the surface Carlos ruled into the
 * chat over the diagnostics-only default. A snapshot: it loads on mount
 * and on explicit refresh, and never polls.
 */
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from './locales.ts'
import { formatDateTime } from './format.ts'
import type { ScopeInjected } from './foundry-face.ts'
import type { ScopeAggregate } from './library-model.ts'
import css from './LibraryPages.module.css'

/** The page's composed props. */
export type ScopePageProps =
  & PropsRuntime<'main'>
  & PropsLocale<'redteamConsole'>
  & InjectFace<ScopeInjected>

type T = ScopePageProps['t']

/** The totals rows, in reading order. */
const TOTAL_ROWS = [
  { field: 'denials', label: 'scope.denials' },
  { field: 'scopeViolations', label: 'scope.scopeViolations' },
  { field: 'policyDenials', label: 'scope.policyDenials' },
  { field: 'hookDenials', label: 'scope.hookDenials' },
  { field: 'authorizationDenied', label: 'scope.authorizationDenied' },
  { field: 'targetAutoHalts', label: 'scope.targetAutoHalts' },
  { field: 'engagementHalts', label: 'scope.engagementHalts' },
  { field: 'aborts', label: 'scope.aborts' },
] as const

/** The aggregate body. */
function Aggregate({ aggregate, t }: { aggregate: ScopeAggregate; t: T }): ReactNode {
  if (!aggregate.available) {
    return <p className={css.errorLine}>{t('scope.unavailable', { reason: aggregate.reason ?? '' })}</p>
  }
  const totals = aggregate.totals
  return (
    <>
      {aggregate.window !== undefined && (
        <p className={css.note}>{t('scope.scanned', { count: aggregate.window.engagementsScanned })}</p>
      )}
      {totals !== undefined && (
        <div className={css.card}>
          <dl className={css.kv}>
            {TOTAL_ROWS.map(row => (
              <div key={row.field} className={css.kvRow}>
                <dt>{t(row.label)}</dt>
                <dd>{totals[row.field]}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {(aggregate.haltReasons ?? []).length > 0 && (
        <div className={css.card}>
          <h3 className={css.subTitle}>{t('scope.haltReasons')}</h3>
          <div className={css.chipRow}>
            {(aggregate.haltReasons ?? []).map(entry => (
              <span key={entry.reason} className={css.chip}>{entry.reason} ×{entry.count}</span>
            ))}
          </div>
        </div>
      )}
      {(aggregate.perEngagement ?? []).length > 0 && (
        <div className={css.card}>
          <h3 className={css.subTitle}>{t('scope.perEngagement')}</h3>
          <ul className={css.list}>
            {(aggregate.perEngagement ?? []).map(entry => (
              <li key={entry.id} className={css.row}>
                <div className={css.rowTop}>
                  <span className={css.rowName}>{entry.target ?? entry.id}</span>
                  <span className={css.rowMeta}>
                    {t('scope.rowSummary', { denials: entry.denials, halts: entry.halts, total: entry.total })}
                  </span>
                </div>
                <p className={css.rowBody}>
                  <span className={css.mono}>{entry.id}</span> · {formatDateTime(entry.startedAt ?? '')}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
      {(aggregate.latest ?? []).length > 0 && (
        <div className={css.card}>
          <h3 className={css.subTitle}>{t('scope.latest')}</h3>
          <ul className={css.list}>
            {(aggregate.latest ?? []).map((event, index) => (
              <li key={`${event.ts}-${index}`} className={css.row}>
                <div className={css.rowTop}>
                  <span className={css.rowName}>{event.kind}</span>
                  <span className={css.rowMeta}>{formatDateTime(event.ts)} · {event.engagementId}</span>
                </div>
                {event.reason !== null && <p className={css.rowBody}>{event.reason}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {(aggregate.notes ?? []).length > 0 && (
        <div className={css.card}>
          <h3 className={css.subTitle}>{t('scope.notes')}</h3>
          {(aggregate.notes ?? []).map(note => <p key={note} className={css.note}>{note}</p>)}
        </div>
      )}
    </>
  )
}

/**
 * The Scope & Safety panel page.
 * @param props - the main-slot runtime, the panel face, and copy.
 * @returns the panel.
 */
export function ScopePage(props: ScopePageProps): ReactNode {
  const { useScope, start, stop, refresh, t } = props
  const state = useScope(s => s)
  useEffect(() => {
    start()
    return () => { stop() }
  }, [start, stop])
  return (
    <div className={css.page}>
      <div className={css.head}>
        <h2 className={css.title}>{t('scope.title')}</h2>
        <div className={css.actions}>
          <button type="button" className={css.button} onClick={() => { refresh() }}>
            {t('scope.refresh')}
          </button>
        </div>
      </div>
      {state.section.kind === 'loading' && <p className={css.note}>{t('scope.loading')}</p>}
      {state.section.kind === 'failed' && (
        <p className={css.errorLine}>{t('scope.failed', { message: state.section.message })}</p>
      )}
      {state.section.kind === 'ready' && <Aggregate aggregate={state.section.value} t={t} />}
    </div>
  )
}
