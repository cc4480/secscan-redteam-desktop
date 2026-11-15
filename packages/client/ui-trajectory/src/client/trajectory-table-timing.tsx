/**
 * Assistant timing metrics for the sticky turn header: total, time to first
 * token, generation time, and throughput.
 */
import css from './TrajectoryTable.module.css'
import type { TrajectoryTranslate } from './locales.ts'
import type { AssistantMetricDetail } from './trajectory-record.ts'
import { useState } from 'react'
import { clickSelectsText } from './trajectory-table-labels.ts'

export function formatDurationMs(milliseconds: number, t: TrajectoryTranslate): string {
  if (milliseconds < 1_000) return t('unit.milliseconds', { value: Math.round(milliseconds) })
  return t('unit.seconds', {
    value: (milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 2 : 1),
  })
}

function formatStartedAt(timestamp: number | null, t: TrajectoryTranslate): string {
  if (timestamp === null || !Number.isFinite(timestamp)) return t('timing.notAvailable')
  const date = new Date(timestamp)
  const two = (value: number) => String(value).padStart(2, '0')
  const three = (value: number) => String(value).padStart(3, '0')
  const time = `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}.${three(date.getMilliseconds())}`
  const day = `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`
  return `${day} ${time}`
}

export function StartedAtValue({ timestamp, t }: { timestamp: number | null; t: TrajectoryTranslate }) {
  const [showUnix, setShowUnix] = useState(false)
  if (timestamp === null || !Number.isFinite(timestamp)) return <dd>{t('timing.notAvailable')}</dd>
  return (
    <dd>
      <button
        type="button"
        className={css.timestampToggle}
        title={showUnix ? t('timing.showLocalTime') : t('timing.showUnixTimestamp')}
        onClick={(event) => {
          if (clickSelectsText(event.currentTarget)) return
          setShowUnix(current => !current)
        }}
      >
        {showUnix ? (timestamp / 1_000).toFixed(3) : formatStartedAt(timestamp, t)}
      </button>
    </dd>
  )
}

function totalTime(metrics: AssistantMetricDetail, t: TrajectoryTranslate): string {
  if (!metrics.timingRecorded) return t('timing.notRecorded')
  if (metrics.stepStartTime === null) return t('timing.stepStartUnavailable')
  if (metrics.completedTime === null) return t('status.pending')
  return formatDurationMs(Math.max(0, metrics.completedTime - metrics.stepStartTime), t)
}

function ttft(metrics: AssistantMetricDetail, t: TrajectoryTranslate): string {
  if (!metrics.timingRecorded) return t('timing.notRecorded')
  if (metrics.stepStartTime === null) return t('timing.stepStartUnavailable')
  if (metrics.firstTokenTime === null) return t('timing.firstTokenUnavailable')
  return formatDurationMs(Math.max(0, metrics.firstTokenTime - metrics.stepStartTime), t)
}

function generationTime(metrics: AssistantMetricDetail, t: TrajectoryTranslate): string {
  if (!metrics.timingRecorded || metrics.firstTokenTime === null) return t('timing.firstTokenUnavailable')
  if (metrics.completedTime === null) return t('status.pending')
  return formatDurationMs(Math.max(0, metrics.completedTime - metrics.firstTokenTime), t)
}

function throughput(metrics: AssistantMetricDetail, t: TrajectoryTranslate): string {
  if (!metrics.usageProvided) return t('timing.usageUnavailable')
  if (metrics.outputTokens === null) return t('timing.outputTokensUnavailable')
  if (!metrics.timingRecorded || metrics.firstTokenTime === null) return t('timing.firstTokenUnavailable')
  if (metrics.completedTime === null) return t('status.pending')
  const generationSeconds = (metrics.completedTime - metrics.firstTokenTime) / 1_000
  if (generationSeconds <= 0) return t('timing.durationTooShort')
  return t('unit.tokensPerSecond', {
    value: (metrics.outputTokens / generationSeconds).toFixed(1),
  })
}

export function AssistantTimingPanel({
  metrics,
  t,
}: { metrics: AssistantMetricDetail; t: TrajectoryTranslate }) {
  return (
    <dl className={css.overview}>
      <div><dt>{t('timing.started')}</dt><StartedAtValue timestamp={metrics.stepStartTime} t={t} /></div>
      <div><dt>{t('timing.totalDuration')}</dt><dd>{totalTime(metrics, t)}</dd></div>
      <div><dt>{t('timing.ttft')}</dt><dd>{ttft(metrics, t)}</dd></div>
      <div><dt>{t('timing.generation')}</dt><dd>{generationTime(metrics, t)}</dd></div>
      <div><dt>{t('timing.throughput')}</dt><dd>{throughput(metrics, t)}</dd></div>
    </dl>
  )
}
