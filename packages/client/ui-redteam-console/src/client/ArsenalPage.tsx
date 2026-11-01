/**
 * The Arsenal main panel: browse, search, and task-shaped recommend
 * over the curated index (1,039 entries), through the Phase 0 bridge —
 * the browser never speaks MCP. On demand only: the census loads on
 * mount, everything else answers a click. Thin collections are shown
 * with their real counts — the index's gaps are data, not embarrassment.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from './locales.ts'
import type { ArsenalInjected } from './arsenal-face.ts'
import type { ArsenalPanelState } from './library-store.ts'
import css from './LibraryPages.module.css'

/** The page's composed props. */
export type ArsenalPageProps =
  & PropsRuntime<'main'>
  & PropsLocale<'redteamConsole'>
  & InjectFace<ArsenalInjected>

type T = ArsenalPageProps['t']

/** The browse area: the topic census, or one topic's collections. */
function BrowseArea({ state, browse, t }: {
  state: ArsenalPanelState
  browse: ArsenalInjected['browse']
  t: T
}): ReactNode {
  if (state.results !== undefined) return null
  const browseState = state.browse
  if (browseState.kind === 'loading') return <p className={css.note}>{t('arsenal.loading')}</p>
  if (browseState.kind === 'failed') {
    return <p className={css.errorLine}>{t('arsenal.failed', { message: browseState.message })}</p>
  }
  const value = browseState.value
  if (value.topics !== undefined) {
    return (
      <div className={css.card}>
        <h3 className={css.subTitle}>{t('arsenal.topics')}</h3>
        <div className={css.list}>
          {value.topics.map(topic => (
            <button
              key={topic.topic}
              type="button"
              className={css.topicButton}
              onClick={() => { browse(topic.topic) }}
            >
              <span className={css.rowName}>{topic.topic}</span>
              <span className={css.rowMeta}>
                {topic.collections} · {t('arsenal.entries', { count: topic.entries })}
              </span>
            </button>
          ))}
        </div>
      </div>
    )
  }
  return (
    <div className={css.card}>
      <h3 className={css.subTitle}>{t('arsenal.collections')}</h3>
      <div className={css.actions}>
        <button type="button" className={css.button} onClick={() => { browse() }}>
          {t('arsenal.back')}
        </button>
      </div>
      <ul className={css.list}>
        {(value.collections ?? []).map(collection => (
          <li key={collection.slug} className={css.row}>
            <div className={css.rowTop}>
              <span className={css.rowName}>{collection.name}</span>
              <span className={css.rowMeta}>{t('arsenal.entries', { count: collection.entry_count })}</span>
            </div>
            <p className={css.rowBody}>{collection.description}</p>
            {!collection.level2 && <p className={css.note}>{t('arsenal.level1')}</p>}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The results area: one search or recommend answer. */
function ResultsArea({ state, clearResults, t }: {
  state: ArsenalPanelState
  clearResults: ArsenalInjected['clearResults']
  t: T
}): ReactNode {
  const results = state.results
  if (results === undefined) return null
  if (results.kind === 'loading') return <p className={css.note}>{t('arsenal.loading')}</p>
  if (results.kind === 'failed') {
    return <p className={css.errorLine}>{t('arsenal.failed', { message: results.message })}</p>
  }
  const value = results.value
  return (
    <div className={css.card}>
      <div className={css.head}>
        <h3 className={css.subTitle}>
          {t('arsenal.results', { total: value.total })}
          {state.query !== undefined && ` · ${t('arsenal.forQuery', { query: state.query })}`}
        </h3>
        <button type="button" className={css.button} onClick={() => { clearResults() }}>
          {t('arsenal.back')}
        </button>
      </div>
      {value.results.length === 0 && <p className={css.note}>{t('arsenal.empty')}</p>}
      <ul className={css.list}>
        {value.results.map(item => (
          <li key={`${item.collection}:${item.name}`} className={css.row}>
            <div className={css.rowTop}>
              <a className={css.rowName} href={item.url} target="_blank" rel="noreferrer">{item.name}</a>
              <span className={css.rowMeta}>{item.collection}</span>
            </div>
            <p className={css.rowBody}>{item.description}</p>
            <div className={css.chipRow}>
              {item.tags.map(tag => <span key={tag} className={css.chip}>{tag}</span>)}
              {item.battery.map(entry => <span key={entry} className={css.chip}>{entry}</span>)}
            </div>
            {item.why !== undefined && item.why.length > 0 && (
              <p className={css.note}>{t('arsenal.why', { facets: item.why.join(', ') })}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * The Arsenal panel page.
 * @param props - the main-slot runtime, the panel face, and copy.
 * @returns the panel.
 */
export function ArsenalPage(props: ArsenalPageProps): ReactNode {
  const { useArsenal, start, stop, browse, search, recommend, clearResults, t } = props
  const state = useArsenal(s => s)
  const [text, setText] = useState('')
  useEffect(() => {
    start()
    return () => { stop() }
  }, [start, stop])
  return (
    <div className={css.page}>
      <div className={css.head}>
        <h2 className={css.title}>{t('arsenal.title')}</h2>
      </div>
      <form
        className={css.inputRow}
        onSubmit={(event) => {
          event.preventDefault()
          search(text)
        }}
      >
        <input
          aria-label={t('arsenal.searchLabel')}
          value={text}
          onChange={(event) => { setText(event.target.value) }}
        />
        <button type="submit" className={css.button}>{t('arsenal.searchButton')}</button>
        <button
          type="button"
          className={css.button}
          onClick={() => { recommend(text) }}
        >
          {t('arsenal.recommendButton')}
        </button>
      </form>
      <ResultsArea state={state} clearResults={clearResults} t={t} />
      <BrowseArea state={state} browse={browse} t={t} />
    </div>
  )
}
