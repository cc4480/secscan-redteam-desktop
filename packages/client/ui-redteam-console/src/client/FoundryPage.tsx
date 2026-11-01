/**
 * The Foundry main panel: the Dataset Foundry's state in the chat —
 * the located snapshot and its bundles, the gate CLI, the app-data
 * store's scan-created cases, and the Gold Loop — with the three gate
 * actions (verify / run-gold / loop) firing on the console.
 *
 * Nothing polls: state loads on mount and on explicit refresh, and an
 * action's answer lands when the console's run settles (run-gold can
 * take minutes there; the button stays disabled meanwhile). Content
 * surfaces are solid theme fills — no backdrop-filter (glass guardrail).
 */
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from './locales.ts'
import type { FoundryInjected } from './foundry-face.ts'
import type {
  FoundryActionKind, FoundryRunGoldResult, FoundryState, FoundryVerifyResult,
} from './library-model.ts'
import type { FoundryLoopResult } from './library-model.ts'
import type { FoundryActionState } from './library-store.ts'
import css from './LibraryPages.module.css'

/** The page's composed props. */
export type FoundryPageProps =
  & PropsRuntime<'main'>
  & PropsLocale<'redteamConsole'>
  & InjectFace<FoundryInjected>

type T = FoundryPageProps['t']

/** The action buttons, in firing order. */
const ACTIONS: readonly { kind: FoundryActionKind; label: 'foundry.verify' | 'foundry.runGold' | 'foundry.runLoop' }[] = [
  { kind: 'verify', label: 'foundry.verify' },
  { kind: 'run-gold', label: 'foundry.runGold' },
  { kind: 'loop', label: 'foundry.runLoop' },
]

/** The settled action's answer, by kind. */
function ActionResult({ action, t }: { action: FoundryActionState; t: T }): ReactNode {
  if (action.kind === 'idle') return null
  if (action.kind === 'running') return <p className={css.note}>{t('foundry.running')}</p>
  if (action.kind === 'failed') return <p className={css.errorLine}>{t('foundry.actionFailed', { message: action.message })}</p>
  const result = action.result
  if (action.action === 'verify') {
    const verify = result as FoundryVerifyResult
    return (
      <div className={css.card}>
        <h3 className={css.subTitle}>{t('foundry.verify')}</h3>
        {verify.totals !== undefined && (
          <p>{t('foundry.verifyTotals', { ok: verify.totals.ok, total: verify.totals.total })}</p>
        )}
        <div className={css.chipRow}>
          {(verify.perFamily ?? []).map(row => (
            <span key={row.family} className={css.chip}>
              {t('foundry.familyRow', { family: row.family, ok: row.ok, total: row.total })}
            </span>
          ))}
        </div>
      </div>
    )
  }
  if (action.action === 'run-gold') {
    const gold = result as FoundryRunGoldResult
    return (
      <div className={css.card}>
        <h3 className={css.subTitle}>{t('foundry.runGold')}</h3>
        <div className={css.chipRow}>
          {(gold.perFamily ?? []).map(row => (
            <span key={row.family} className={css.chip}>
              {t('foundry.familyRow', { family: row.family, ok: row.ok, total: row.total })}
            </span>
          ))}
        </div>
        <ul className={css.list}>
          {(gold.bundles ?? []).map(bundle => (
            <li key={bundle.slug} className={css.row}>
              <div className={css.rowTop}>
                <span className={css.rowName}>{bundle.slug}</span>
                {bundle.gatePass !== null && (
                  <span className={bundle.gatePass ? css.okMark : css.failMark}>
                    {t(bundle.gatePass ? 'foundry.gatePass' : 'foundry.gateFail')}
                  </span>
                )}
                <span className={css.rowMeta}>
                  {bundle.passRate !== null && `${Math.round(bundle.passRate * 100)}%`}
                  {bundle.fitness !== null && ` · ${t('foundry.fitness')} ${bundle.fitness.toFixed(2)}`}
                </span>
              </div>
              {bundle.error !== null && <p className={css.errorLine}>{bundle.error}</p>}
            </li>
          ))}
        </ul>
      </div>
    )
  }
  const loop = result as FoundryLoopResult
  return (
    <div className={css.card}>
      <h3 className={css.subTitle}>{t('foundry.runLoop')}</h3>
      <p>
        {t('foundry.loopSummary', {
          cycle: loop.summary.cycle,
          scored: loop.summary.casesScored,
          mutants: loop.summary.mutantsGenerated,
          survivors: loop.summary.survivorsRegistered,
        })}
      </p>
      {loop.summary.error !== null && <p className={css.errorLine}>{loop.summary.error}</p>}
      {loop.summary.notes.map(note => <p key={note} className={css.note}>{note}</p>)}
    </div>
  )
}

/** The state cards: snapshot, gate, store, loop. */
function StateCards({ state, t }: { state: FoundryState; t: T }): ReactNode {
  const { snapshot, store, loop } = state
  return (
    <>
      {!state.available && <p className={css.errorLine}>{state.reason ?? t('foundry.unavailable')}</p>}
      {snapshot !== null && (
        <div className={css.card}>
          <h3 className={css.subTitle}>{t('foundry.snapshot')}</h3>
          <dl className={css.kv}>
            <div className={css.kvRow}>
              <dt>{t('foundry.snapshotBundles')}</dt>
              <dd>
                {snapshot.counts.total} · {t('foundry.gold')} {snapshot.counts.gold} · {t('foundry.silver')} {snapshot.counts.silver}
              </dd>
            </div>
            {snapshot.name !== null && (
              <div className={css.kvRow}><dt>{t('foundry.snapshotName')}</dt><dd>{snapshot.name}</dd></div>
            )}
            {snapshot.generatedAt !== null && (
              <div className={css.kvRow}><dt>{t('foundry.snapshotGenerated')}</dt><dd className={css.mono}>{snapshot.generatedAt}</dd></div>
            )}
          </dl>
          <ul className={css.list}>
            {snapshot.bundles.slice(0, 10).map(bundle => (
              <li key={bundle.slug} className={css.row}>
                <div className={css.rowTop}>
                  <span className={css.rowName}>{bundle.slug}</span>
                  <span className={css.rowMeta}>
                    {bundle.family} · {bundle.loopTier} · {bundle.status}
                    {bundle.fitness !== null && ` · ${t('foundry.fitness')} ${bundle.fitness.toFixed(2)}`}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className={css.card}>
        <h3 className={css.subTitle}>{t('foundry.gate')}</h3>
        <p>
          {state.gate.available ? t('foundry.gateAvailable') : t('foundry.gateMissing')}
          {state.gate.cliPath !== null && <span className={css.mono}> · {state.gate.cliPath}</span>}
        </p>
      </div>
      {store.available && (
        <div className={css.card}>
          <h3 className={css.subTitle}>{t('foundry.store')}</h3>
          <dl className={css.kv}>
            <div className={css.kvRow}>
              <dt>{t('foundry.storeTotal')}</dt>
              <dd>{store.counts.total}</dd>
            </div>
          </dl>
          <div className={css.chipRow}>
            {Object.entries(store.counts.byFamily).map(([family, count]) => (
              <span key={family} className={css.chip}>{t('foundry.familyRow', { family, ok: count, total: store.counts.total })}</span>
            ))}
          </div>
          {store.cases.length > 0 && (
            <>
              <h4 className={css.subTitle}>{t('foundry.cases')}</h4>
              <ul className={css.list}>
                {store.cases.slice(0, 20).map(foundryCase => (
                  <li key={foundryCase.id} className={css.row}>
                    <div className={css.rowTop}>
                      <span className={css.rowName}>{foundryCase.id}</span>
                      <span className={css.rowMeta}>
                        {foundryCase.family} · {foundryCase.tier} · {foundryCase.severity} · {foundryCase.vulnClass}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      <div className={css.card}>
        <h3 className={css.subTitle}>{t('foundry.loop')}</h3>
        <dl className={css.kv}>
          <div className={css.kvRow}>
            <dt>{t('foundry.cycles')}</dt>
            <dd>{loop.cyclesRun}</dd>
          </div>
        </dl>
        <ul className={css.list}>
          {loop.fitness.slice(0, 10).map(record => (
            <li key={record.caseId} className={css.row}>
              <div className={css.rowTop}>
                <span className={css.rowName}>{record.caseId}</span>
                <span className={css.rowMeta}>{t('foundry.fitness')} {record.fitness.toFixed(2)}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}

/**
 * The Foundry panel page.
 * @param props - the main-slot runtime, the panel face, and copy.
 * @returns the panel.
 */
export function FoundryPage(props: FoundryPageProps): ReactNode {
  const { useFoundry, start, stop, refresh, act, t } = props
  const state = useFoundry(s => s)
  useEffect(() => {
    start()
    return () => { stop() }
  }, [start, stop])
  const running = state.action.kind === 'running'
  return (
    <div className={css.page}>
      <div className={css.head}>
        <h2 className={css.title}>{t('foundry.title')}</h2>
        <div className={css.actions}>
          {ACTIONS.map(entry => (
            <button
              key={entry.kind}
              type="button"
              className={css.button}
              disabled={running}
              onClick={() => { act(entry.kind) }}
            >
              {t(entry.label)}
            </button>
          ))}
          <button type="button" className={css.button} onClick={() => { refresh() }}>
            {t('foundry.refresh')}
          </button>
        </div>
      </div>
      <ActionResult action={state.action} t={t} />
      {state.section.kind === 'loading' && <p className={css.note}>{t('foundry.loading')}</p>}
      {state.section.kind === 'failed' && (
        <p className={css.errorLine}>{t('foundry.failed', { message: state.section.message })}</p>
      )}
      {state.section.kind === 'ready' && <StateCards state={state.section.value} t={t} />}
    </div>
  )
}
