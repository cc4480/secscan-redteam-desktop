/**
 * The Watch tab's body: one engagement, watched live.
 *
 * Layout, top to bottom: the engagement picker, the stat-card row and the
 * detail list — the ENGAGEMENT's own numbers from the console's A4 view
 * (its tokens, its steps, its findings), never the chat session's usage —
 * then the fleet roster (each seat's model beside its latest feed
 * activity), the live feed, and, for a live engagement, the console
 * controls. Everything the body keeps lives in its declared store, keyed
 * by tab; everything it asks for goes through its injected face.
 *
 * Content surfaces are solid fills on the theme's layer tokens. There is
 * no backdrop-filter anywhere in this body: glass is the pane container's
 * chrome (the glass guardrail — blur lives on containers, never inside
 * content rows or lists, and never on a surface that repaints per event).
 */
import { useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './locales.ts'
import { Controls } from './Controls.tsx'
import { FeedList } from './FeedList.tsx'
import type { WatchInjected } from './face.ts'
import { formatDateTime, formatDuration } from './format.ts'
import type { ConsoleEngagement, ModelSeat } from './model.ts'
import type { createWatchStore } from './store.ts'
import css from './WatchBody.module.css'

/** The body's composed props: the tab it draws, its store, its face, and its copy. */
export type WatchBodyProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsStore<ReturnType<typeof createWatchStore>>
  & WatchInjected
  & PropsLocale<'redteamConsole'>

/** One stat card: a label, a value, and an optional subline. */
function StatCard({ label, value, sub }: { label: string; value: string; sub?: string | undefined }): ReactNode {
  return (
    <div className={css.statCard}>
      <span className={css.statLabel}>{label}</span>
      <span className={css.statValue}>{value}</span>
      {sub !== undefined && <span className={css.statSub}>{sub}</span>}
    </div>
  )
}

/** The detail list's rows for one engagement, in reading order. */
function detailRows(
  t: TranslateNS<'redteamConsole'>,
  engagement: ConsoleEngagement,
): readonly (readonly [string, string])[] {
  const rows: (readonly [string, string])[] = [
    [t('kv.target'), engagement.target],
    [t('kv.mode'), engagement.mode],
    [t('kv.started'), formatDateTime(engagement.startedAt)],
    [t('kv.updated'), formatDateTime(engagement.updatedAt)],
    [t('kv.duration'), engagement.durationMs === null ? t('stat.none') : formatDuration(t, engagement.durationMs)],
    [t('kv.actions'), String(engagement.actions)],
    [t('kv.report'), engagement.hasReport ? t('kv.reportYes') : t('kv.reportNo')],
  ]
  if (engagement.verdicts !== null) {
    const parts = Object.entries(engagement.verdicts.byDisposition).map(([name, count]) => `${name} ${count}`)
    rows.push([t('kv.verdicts'), parts.length === 0 ? String(engagement.verdicts.total) : `${engagement.verdicts.total} · ${parts.join(', ')}`])
  }
  if (engagement.layers !== null && engagement.layers.ids.length > 0) {
    rows.push([t('kv.layers'), engagement.layers.ids.join(', ')])
  }
  if (engagement.error !== undefined) rows.push([t('kv.error'), engagement.error])
  return rows
}

/** One roster row: a seat's role and model, beside its latest feed activity. */
function RosterRow({ seat, activity, t }: {
  seat: ModelSeat
  activity: string | undefined
  t: TranslateNS<'redteamConsole'>
}): ReactNode {
  return (
    <li className={css.rosterRow}>
      <span className={css.rosterRole}>{seat.role}</span>
      <span className={css.rosterModel}>{`${seat.provider} · ${seat.model}`}</span>
      <span className={css.rosterActivity}>{activity ?? t('roster.noActivity')}</span>
    </li>
  )
}

/** The watch body: picker, the engagement's own stats, roster, feed, controls. */
export function WatchBody(props: WatchBodyProps): ReactNode {
  const { useTabInfo, useStore, start, refresh, select, abort, escalate, t } = props
  const { tab } = useTabInfo()
  const { signal } = tab
  const state = useStore(store => store.byTab[tab.id])

  useEffect(() => {
    if (state !== undefined || signal.aborted) return
    start(tab.id, signal)
  }, [state, tab.id, signal, start])

  const selected = state?.list.kind === 'ready'
    ? state.list.engagements.find(entry => entry.id === state.selectedId)
    : undefined
  /** Latest feed event per actor, for the roster's activity lines. */
  const activityByActor = useMemo(() => {
    const byActor = new Map<string, string>()
    if (state !== undefined) {
      for (const event of state.feed) {
        byActor.set(event.actor.toLowerCase(), t('roster.lastAction', { action: event.action, result: event.result }))
      }
    }
    return byActor
  }, [state, t])

  if (state === undefined || state.list.kind === 'loading') {
    return (
      <div className={css.root} role="region" aria-label={t('watch.aria')}>
        <p className={css.note}>{t('watch.loading')}</p>
      </div>
    )
  }
  if (state.list.kind === 'failed') {
    return (
      <div className={css.root} role="region" aria-label={t('watch.aria')}>
        <p className={css.errorLine}>{t('watch.failed', { message: state.list.message })}</p>
        <button type="button" className={css.button} onClick={() => { refresh(tab.id) }}>{t('watch.refresh')}</button>
      </div>
    )
  }
  if (!state.list.available) {
    return (
      <div className={css.root} role="region" aria-label={t('watch.aria')}>
        <p className={css.note}>{t('watch.unavailable', { reason: state.list.reason ?? '' })}</p>
      </div>
    )
  }
  if (selected === undefined) {
    return (
      <div className={css.root} role="region" aria-label={t('watch.aria')}>
        <p className={css.note}>{t('watch.empty')}</p>
      </div>
    )
  }
  return (
    <div className={css.root} role="region" aria-label={t('watch.aria')}>
      <div className={css.header}>
        <select
          className={css.picker}
          aria-label={t('watch.select')}
          value={selected.id}
          onChange={(change) => { select(tab.id, change.target.value) }}
        >
          {state.list.engagements.map(entry => (
            <option key={entry.id} value={entry.id}>{`${entry.id} · ${entry.target}`}</option>
          ))}
        </select>
        <button type="button" className={css.button} onClick={() => { refresh(tab.id) }}>{t('watch.refresh')}</button>
      </div>
      <div className={css.scroll}>
        <div className={css.statRow}>
          <StatCard label={t('stat.status')} value={selected.status} sub={`${t('stat.phase')}: ${selected.phase}`} />
          <StatCard
            label={t('stat.tokens')}
            value={selected.tokens === null ? t('stat.none') : selected.tokens.total.toLocaleString()}
            sub={selected.tokens === null
              ? undefined
              : t('stat.tokensDetail', { input: selected.tokens.in.toLocaleString(), output: selected.tokens.out.toLocaleString() })}
          />
          <StatCard label={t('stat.steps')} value={selected.steps === null ? t('stat.none') : String(selected.steps)} />
          <StatCard
            label={t('stat.findings')}
            value={String(selected.findings.total)}
            sub={t('stat.proven', { proven: selected.findings.proven, total: selected.findings.total })}
          />
        </div>
        <dl className={css.kv}>
          {detailRows(t, selected).map(([name, value]) => (
            <div key={name} className={css.kvRow}>
              <dt>{name}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {state.seats !== undefined && state.seats.length > 0 && (
          <section className={css.section}>
            <h3 className={css.sectionTitle}>{t('roster.title')}</h3>
            <ul className={css.roster}>
              {state.seats.map(seat => (
                <RosterRow
                  key={seat.role}
                  seat={seat}
                  activity={activityByActor.get(seat.role.toLowerCase())}
                  t={t}
                />
              ))}
            </ul>
          </section>
        )}
        <FeedList events={state.feed} status={state.feedStatus} t={t} />
        {selected.live && (
          <Controls
            tabId={tab.id}
            engagement={selected}
            controlNote={state.controlNote}
            controlOk={state.controlOk}
            controlError={state.controlError}
            onAbort={abort}
            onEscalate={escalate}
            t={t}
          />
        )}
      </div>
    </div>
  )
}
