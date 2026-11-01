/** Completed-Turn token usage action and its accounting details dialog. */

import { createPortal } from 'react-dom'
import { IconDatabaseOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { estimateTokenUsageCostUsd } from '@deepseek-ai/dsh-token-meter/client'
import type { TurnTokenUsage } from '../contract/chat-nodes.ts'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { formatCacheHitPercent, formatExactTokens, formatTokens } from './token-format.ts'
import { MEASURE_STYLE, useStatDialog } from './stat-dialog.ts'
import css from './TurnUsagePanel.module.css'
import dialogCss from './stat-dialog.module.css'

export interface TurnUsagePanelProps {
  usage: TurnTokenUsage
  /** The owning view's locale seat, passed down as a plain prop. */
  t: ChatViewSlotProps['t']
}

function formatCompactCount(value: number, t: ChatViewSlotProps['t']): string {
  return t('message.turnUsage.count', { count: formatTokens(value, t) })
}

function formatExactCount(value: number, t: ChatViewSlotProps['t']): string {
  return t('message.turnUsage.count', { count: formatExactTokens(value, t) })
}

/**
 * Turn-usage IconActions pill with a click-open Turn-usage details dialog.
 * @param props - Turn usage buckets and locale seat.
 * @returns The trigger and, while open, its portaled dialog anchored above the trigger.
 */
export function TurnUsagePanel({ usage, t }: TurnUsagePanelProps) {
  const { open, setOpen, rootRef, panelRef, pos } = useStatDialog()

  const cacheHit = usage.cacheReadTokens === undefined
    ? null
    : formatCacheHitPercent(usage.cacheReadTokens, usage.totalTokens - usage.outputTokens, 1)
  // The pill headline splits fresh volume from cache reads, like the footer
  // pill: the raw total alone presents cache-served tokens at fresh weight.
  // The split shows only when the fold proved the cache-read bucket; the
  // exact total stays in the dialog.
  const cacheRead = usage.cacheReadTokens
  const total = formatCompactCount(
    cacheRead !== undefined && cacheRead > 0 ? usage.totalTokens - cacheRead : usage.totalTokens,
    t,
  )
  const label = cacheRead !== undefined && cacheRead > 0
    ? `${t('message.turnUsage.consumed', { total })} ${t('message.turnUsage.cached', { count: formatTokens(cacheRead, t) })}`
    : t('message.turnUsage.consumed', { total })
  // A dollar figure exists only when every billed route declares a rate and
  // the full bucket split is proven; unrated seats show the split alone.
  const cost = estimateTokenUsageCostUsd(usage, usage.routes)
  const routes = usage.routes?.map(route => `${route.provider}/${route.model}`).join(', ') ?? ''

  return (
    <span ref={rootRef} className={css.root}>
      <button
        type="button"
        className={css.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => { setOpen(!open) }}
      >
        <IconDatabaseOutlineRegular />
        <span className={css.label}>{label}</span>
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className={dialogCss.panel}
          role="dialog"
          aria-label={t('message.turnUsage.title')}
          style={pos ?? MEASURE_STYLE}
        >
          <div className={dialogCss.title}>
            <span className={dialogCss.titleLabel}>
              <IconDatabaseOutlineRegular />
              {t('message.turnUsage.title')}
            </span>
            <span className={dialogCss.titleValue}>{formatExactCount(usage.totalTokens, t)}</span>
          </div>
          <div className={dialogCss.titleRule} aria-hidden />
          <dl className={dialogCss.details} data-turn-usage-details>
            {routes !== '' && (
              <>
                <dt>{t('message.turnUsage.model')}</dt>
                <dd className={dialogCss.route}>{routes}</dd>
              </>
            )}
            {cacheHit !== null && (
              <>
                <dt>{t('message.turnUsage.cacheHit')}</dt>
                <dd>{`${cacheHit}%`}</dd>
              </>
            )}
            <dt>{t('message.turnUsage.input')}</dt>
            <dd>{formatExactCount(usage.uncachedInputTokens, t)}</dd>
            {usage.cacheReadTokens !== undefined && (
              <>
                <dt>{t('message.turnUsage.cacheRead')}</dt>
                <dd>{formatExactCount(usage.cacheReadTokens, t)}</dd>
              </>
            )}
            {usage.cacheWriteTokens !== undefined && (
              <>
                <dt>{t('message.turnUsage.cacheWrite')}</dt>
                <dd>{formatExactCount(usage.cacheWriteTokens, t)}</dd>
              </>
            )}
            <dt>{t('message.turnUsage.output')}</dt>
            <dd>
              {formatExactCount(usage.outputTokens, t)}
              {usage.reasoningTokens !== undefined && (
                <span className={dialogCss.reasoning}>
                  {t('message.turnUsage.reasoning', { tokens: formatExactCount(usage.reasoningTokens, t) })}
                </span>
              )}
            </dd>
            {cost !== undefined && (
              <>
                <dt>{t('message.turnUsage.price')}</dt>
                <dd>{t('message.turnUsage.priceValue', { amount: cost.toFixed(2) })}</dd>
              </>
            )}
          </dl>
        </div>,
        document.body,
      )}
    </span>
  )
}
