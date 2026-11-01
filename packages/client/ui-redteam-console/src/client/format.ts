/**
 * Pure display derivations for the Watch tab: durations, clocks, and the
 * feed's semantic kind classification. Kinds drive the feed's color coding
 * (what is running, what a tool did, what was found, what was refused) so
 * the operator reads the stream by color AND by text — never by color
 * alone: every row also carries its actor, action, and result verbatim.
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type {} from './locales.ts'
import type { EngagementEvent } from './model.ts'

/** The feed's semantic kinds, one per accent class in the stylesheet. */
export type FeedKind = 'deny' | 'finding' | 'tool' | 'phase' | 'plain'

/**
 * Classify one feed event for color coding.
 * @param event - the event record.
 * @returns its kind: refusals first (a denial inside a tool call is a
 * denial), then findings, tool executions, phase/runner narration, and
 * everything else plain.
 */
export function feedKind(event: EngagementEvent): FeedKind {
  const action = event.action.toLowerCase()
  const result = event.result.toLowerCase()
  if (
    action.includes('denied') || action.includes('violation') || action.includes('policy')
    || action.includes('hook_evaluated') || result.includes('denied') || result.includes('out of scope')
  ) return 'deny'
  if (action.includes('finding') || action.includes('verdict') || action.includes('proof')) return 'finding'
  if (action.includes('_exec') || action.includes('probe') || action.includes('scan')) return 'tool'
  if (event.actor === 'runner' || action.includes('phase') || action.startsWith('engagement_')) return 'phase'
  return 'plain'
}

/**
 * Format a millisecond duration as the dictionaries' compact units.
 * @param t - namespace-bound translate.
 * @param ms - the duration in milliseconds.
 * @returns the localized duration line.
 */
export function formatDuration(t: TranslateNS<'redteamConsole'>, ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  if (totalSeconds < 60) return t('duration.seconds', { seconds: totalSeconds })
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return t('duration.minutes', { minutes, seconds })
  return t('duration.hours', { hours: Math.floor(minutes / 60), minutes: minutes % 60 })
}

/**
 * Format an ISO timestamp as a local wall clock (feed rows).
 * @param iso - the timestamp.
 * @returns HH:MM:SS in the reader's locale and timezone.
 */
export function formatClock(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleTimeString()
}

/**
 * Format an ISO timestamp as a local date + time (detail rows).
 * @param iso - the timestamp.
 * @returns the localized date-time line.
 */
export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}
