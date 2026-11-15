/**
 * Token accounting panels: the per-cell token rows, the request usage rollup,
 * and the request options list.
 */
import css from './TrajectoryTable.module.css'
import type { TrajectoryCellProps } from './trajectory-record.ts'
import type { TrajectoryTranslate } from './locales.ts'
import type { AssistantRequestConfig } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { JsonTreeProps } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TrajectoryUsage } from './trajectory-table-types.ts'
import { JsonTree } from '@deepseek-ai/dsh-client-ui-primitives'
import { jsonTreeLabels } from './trajectory-table-labels.ts'

export function TokenRows({ cell, t }: { cell: TrajectoryCellProps; t: TrajectoryTranslate }) {
  const content = cell.output !== undefined && cell.think !== undefined
    ? Math.max(0, cell.output - cell.think)
    : undefined
  return (
    <>
      <div>
        <dt>{t('usage.tokens')}</dt>
        <dd>{cell.output === undefined ? '—' : t('unit.tokens', { value: cell.output })}</dd>
      </div>
      {cell.think !== undefined && (
        <div className={css.requestTokenDetail}>
          <dt>{t('usage.reasoning')}</dt>
          <dd>{t('unit.tokens', { value: cell.think })}</dd>
        </div>
      )}
      {content !== undefined && (
        <div className={css.requestTokenDetail}>
          <dt>{t('usage.content')}</dt>
          <dd>{t('unit.tokens', { value: content })}</dd>
        </div>
      )}
    </>
  )
}

function inputTotal(usage: TrajectoryUsage): number | undefined {
  if (
    usage.input === undefined
    && usage.cacheRead === undefined
    && usage.cacheWrite === undefined
  ) return undefined
  return (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0)
}

export function UsageRows({ usage, t }: { usage: TrajectoryUsage | undefined; t: TrajectoryTranslate }) {
  if (usage === undefined) return <p className={css.noPayload}>{t('usage.notReported')}</p>
  const totalInput = inputTotal(usage)
  const otherOutput = usage.output !== undefined && usage.reasoning !== undefined
    ? usage.output - usage.reasoning
    : undefined
  return (
    <dl className={css.overview}>
      {totalInput !== undefined && (
        <div><dt>{t('usage.input')}</dt><dd>{t('unit.tokens', { value: totalInput })}</dd></div>
      )}
      {usage.cacheRead !== undefined && (
        <div className={css.requestTokenDetail}>
          <dt>{t('usage.cached')}</dt>
          <dd>{t('unit.tokens', { value: usage.cacheRead })}</dd>
        </div>
      )}
      {usage.cacheWrite !== undefined && (
        <div className={css.requestTokenDetail}>
          <dt>{t('usage.cacheCreated')}</dt>
          <dd>{t('unit.tokens', { value: usage.cacheWrite })}</dd>
        </div>
      )}
      {usage.input !== undefined && (
        <div className={css.requestTokenDetail}>
          <dt>{t('usage.other')}</dt>
          <dd>{t('unit.tokens', { value: usage.input })}</dd>
        </div>
      )}
      {usage.output !== undefined && (
        <div><dt>{t('usage.output')}</dt><dd>{t('unit.tokens', { value: usage.output })}</dd></div>
      )}
      {usage.reasoning !== undefined && (
        <div className={css.requestTokenDetail}>
          <dt>{t('usage.reasoning')}</dt>
          <dd>{t('unit.tokens', { value: usage.reasoning })}</dd>
        </div>
      )}
      {otherOutput !== undefined && (
        <div className={css.requestTokenDetail}>
          <dt>{t('usage.content')}</dt>
          <dd>{t('unit.tokens', { value: otherOutput })}</dd>
        </div>
      )}
    </dl>
  )
}

export function RequestUsagePanel({
  usage,
  cumulative,
  t,
}: {
  usage: TrajectoryUsage | undefined
  cumulative: TrajectoryUsage | undefined
  t: TrajectoryTranslate
}) {
  return (
    <div className={css.usagePanel}>
      <section className={css.usageGroup}>
        <h4 className={css.usageHeading}>{t('usage.thisRequest')}</h4>
        <UsageRows usage={usage} t={t} />
      </section>
      <section className={css.usageGroup}>
        <h4 className={css.usageHeading}>{t('usage.sessionCumulative')}</h4>
        <UsageRows usage={cumulative} t={t} />
      </section>
    </div>
  )
}

export function RequestOptions({
  options,
  preview = false,
  stringWrapping,
  t,
}: {
  options: AssistantRequestConfig | undefined
  preview?: boolean
  stringWrapping: JsonTreeProps['stringWrapping']
  t: TrajectoryTranslate
}) {
  if (options === undefined) {
    return <p className={css.noPayload}>{t('options.notRecorded')}</p>
  }
  return (
    <JsonTree
      data={options}
      stringWrapping={stringWrapping}
      collapsedStringLines={preview ? 3 : 12}
      label={t('options.json')}
      labels={jsonTreeLabels(t)}
      className={preview ? css.jsonPreview : css.jsonPayload}
    />
  )
}
