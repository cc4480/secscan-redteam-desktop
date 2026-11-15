/**
 * code_program input and output views, and the inspector overview section.
 */
import css from './TrajectoryTable.module.css'
import type { CodeProgram } from './code-program.ts'
import type { JsonTreeProps } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TrajectoryTranslate } from './locales.ts'
import type { ReactNode } from 'react'
import type { TableRecord } from './trajectory-table-types.ts'
import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react'
import {
  CodeBlock, IconChevronRightOutlineRegular, IconWrapLinesOutlineRegular, JsonTree,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { InspectorCopyButton, parseJsonContainer } from './trajectory-table-payload.tsx'
import { jsonTreeLabels } from './trajectory-table-labels.ts'
import { stateOf } from './trajectory-table-collapse.ts'

export function ProgramInput({ program, initialWrapped, stringWrapping, onOpen, t }: {
  program: CodeProgram
  initialWrapped: boolean
  stringWrapping: JsonTreeProps['stringWrapping']
  onOpen?: () => void
  t: TrajectoryTranslate
}) {
  const contentsId = useId()
  const [wrapped, setWrapped] = useState(initialWrapped)
  const [showJson, setShowJson] = useState(false)
  const actions = (
    <span className={css.programActions}>
      {!showJson && program.language !== undefined && (
        <span className={css.programLanguage}>{program.language}</span>
      )}
      {!showJson && (
        <button
          type="button"
          className={css.programAction}
          aria-label={t('record.wrapLines')}
          title={t('record.wrapLines')}
          aria-pressed={wrapped}
          aria-controls={contentsId}
          onClick={() => {
            const next = !wrapped
            setWrapped(next)
            stringWrapping?.setDefault(next)
          }}
        >
          <IconWrapLinesOutlineRegular size={12} />
        </button>
      )}
      {onOpen === undefined && (
        <button
          type="button"
          className={css.programAction}
          aria-label={t('code.originalJson')}
          title={t('code.originalJson')}
          aria-pressed={showJson}
          aria-controls={contentsId}
          onClick={() => { setShowJson(value => !value) }}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 2H5a2 2 0 0 0-2 2v2a2 2 0 0 1-2 2 2 2 0 0 1 2 2v2a2 2 0 0 0 2 2h1" />
            <path d="M10 2h1a2 2 0 0 1 2 2v2a2 2 0 0 0 2 2 2 2 0 0 0-2 2v2a2 2 0 0 1-2 2h-1" />
          </svg>
        </button>
      )}
      <InspectorCopyButton
        text={showJson ? program.rawInput : program.source}
        label={t(showJson ? 'copy.json' : 'code.copySource')}
        t={t}
      />
    </span>
  )
  const body = (
    <div id={contentsId} className={css.programContent} data-wrap={wrapped}>
      {showJson
        ? <JsonTree data={program.arguments} label={t('record.parametersJson')}
          labels={jsonTreeLabels(t)} stringWrapping={stringWrapping} />
        : <CodeBlock code={program.source} lang={program.language} lineNumbers showHeader={false}
          className={css.programSource} copyLabel={t('code.copySource')} copiedLabel={t('copied')} />}
    </div>
  )
  return onOpen === undefined
    ? (
      <section className={css.programPanel}>
        <header className={css.overviewHeading}>
          <span>{t('code.source')}</span>
          {actions}
        </header>
        {body}
      </section>
    )
    : <OverviewSection label={t('code.source')} onOpen={onOpen} actions={actions}>{body}</OverviewSection>
}

export function ProgramOutput({ record, stringWrapping, onOpen, t }: {
  record: TableRecord
  stringWrapping: JsonTreeProps['stringWrapping']
  onOpen?: () => void
  t: TrajectoryTranslate
}) {
  const output = record.cell.outputDetail
  const json = output === undefined || record.cell.isError === true ? undefined : parseJsonContainer(output)
  const actions = output === undefined ? undefined : (
    <span className={css.programActions}>
      <InspectorCopyButton text={output} label={t('code.copyOutput')} t={t} />
    </span>
  )
  const body = (
    <div className={css.programContent}>
      {output === undefined || output === ''
        ? <p className={css.noPayload}>{t(stateOf(record) === 'running' ? 'code.running' : 'record.noOutput')}</p>
        : json !== undefined
          ? <JsonTree data={json} label={t('record.outputJson')} labels={jsonTreeLabels(t)}
            stringWrapping={stringWrapping} collapsedStringLines={onOpen === undefined ? 12 : 3} />
          : <pre className={`${css.programOutput} ${record.cell.isError === true ? css.programError : ''}`}>{output}</pre>}
    </div>
  )
  return onOpen === undefined
    ? (
      <section className={css.programPanel}>
        <header className={css.overviewHeading}>
          <span>{t('code.output')}</span>
          {actions}
        </header>
        {body}
      </section>
    )
    : <OverviewSection label={t('code.output')} onOpen={onOpen} actions={actions}>{body}</OverviewSection>
}

export function OverviewSection({
  label,
  onOpen,
  actions,
  children,
}: {
  label: string
  onOpen: () => void
  actions?: ReactNode
  children: ReactNode
}) {
  const previewRef = useRef<HTMLDivElement>(null)
  const [hasMore, setHasMore] = useState(false)
  const measureOverflow = useCallback((preview: HTMLElement) => {
    setHasMore(preview.scrollHeight - preview.clientHeight - preview.scrollTop > 1)
  }, [])

  useLayoutEffect(() => {
    const preview = previewRef.current as HTMLDivElement
    const measure = () => { measureOverflow(preview) }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(preview)
    for (const child of preview.children) observer.observe(child)
    return () => { observer.disconnect() }
  }, [children, measureOverflow])

  return (
    <section className={css.overviewSection}>
      <h3 className={css.overviewHeading}>
        <button
          type="button"
          className={css.overviewTitle}
          onClick={onOpen}
        >
          <span>{label}</span>
          <IconChevronRightOutlineRegular className={css.overviewTitleIcon} size={12} />
        </button>
        {actions}
      </h3>
      <div
        ref={previewRef}
        className={`${css.overviewPreview} ${css.summaryScrollRegion}`}
        data-summary-scroll-region=""
        data-scroll-more={hasMore || undefined}
        onScroll={(event) => { measureOverflow(event.currentTarget) }}
      >
        {children}
      </div>
    </section>
  )
}
