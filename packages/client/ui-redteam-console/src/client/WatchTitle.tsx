/**
 * The watch type's chip title: the type's label.
 * Registered under `sidebar.right.pane.tab.title`; without it the chip
 * would show the bare label the definition already provides, so this
 * exists to keep the title seat's dispatch uniform with the other types.
 */
import type { ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * The title as the chip and a floating panel's header show it.
 * @param props - the tab information hook.
 * @returns the tab's title text.
 */
export function WatchTitle({ useTabInfo }: PropsRuntime<'sidebar.right.pane.tab.title'>): ReactNode {
  const { tab } = useTabInfo()
  return <>{tab.title}</>
}
