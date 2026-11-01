/**
 * The selected engagement's live feed: a status line and the event stream.
 *
 * Rendering follows the performance guardrail: rows are keyed by event seq
 * and memoized, so a new event mounts one row — the list never re-renders
 * wholesale per event. The scroller follows the tail only while the reader
 * is already at the bottom; a reader who scrolled up to study an event is
 * never yanked down by the stream.
 */
import { memo, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type {} from './locales.ts'
import { feedKind, formatClock } from './format.ts'
import type { EngagementEvent } from './model.ts'
import type { FeedStatus } from './store.ts'
import css from './WatchBody.module.css'

/** Distance from the bottom (px) within which the scroller follows the tail. */
const FOLLOW_SLACK_PX = 48

/** Feed connection state → its dictionary key. */
const FEED_STATUS_KEY = {
  idle: 'feed.idle',
  connecting: 'feed.connecting',
  live: 'feed.live',
  ended: 'feed.ended',
  failed: 'feed.failed',
} as const

/** One feed row: clock, actor, action, and the result in the console's words. */
const FeedRow = memo(function FeedRow({ event }: { event: EngagementEvent }): ReactNode {
  return (
    <li className={clsx(css.feedRow, css[`kind_${feedKind(event)}`])} data-feed-seq={event.seq}>
      <span className={css.feedClock}>{formatClock(event.ts)}</span>
      <span className={css.feedActor}>{event.actor}</span>
      <span className={css.feedAction}>{event.action}</span>
      <span className={css.feedResult}>{event.result}</span>
    </li>
  )
})

/** The feed block's props: its events, its connection state, and its copy. */
export interface FeedListProps {
  readonly events: readonly EngagementEvent[]
  readonly status: FeedStatus
  readonly t: TranslateNS<'redteamConsole'>
}

/**
 * The feed block.
 * @param props - events, connection state, and copy.
 * @returns the status line over the scrolling event list.
 */
export function FeedList({ events, status, t }: FeedListProps): ReactNode {
  const scrollerRef = useRef<HTMLOListElement>(null)
  const followRef = useRef(true)
  useEffect(() => {
    const scroller = scrollerRef.current
    if (scroller !== null && followRef.current) scroller.scrollTop = scroller.scrollHeight
  }, [events.length])
  return (
    <section className={css.section}>
      <div className={css.sectionHead}>
        <h3 className={css.sectionTitle}>{t('feed.title')}</h3>
        <span className={clsx(css.feedStatus, css[`feedStatus_${status}`])}>{t(FEED_STATUS_KEY[status])}</span>
      </div>
      {events.length === 0
        ? <p className={css.note}>{t('feed.empty')}</p>
        : (
          <ol
            ref={scrollerRef}
            className={css.feed}
            onScroll={(scrollEvent) => {
              const el = scrollEvent.currentTarget
              followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_SLACK_PX
            }}
          >
            {events.map(event => <FeedRow key={event.seq} event={event} />)}
          </ol>
        )}
    </section>
  )
}
