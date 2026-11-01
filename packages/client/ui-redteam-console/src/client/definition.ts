/**
 * Stage one of the Watch type's registration: what it IS.
 *
 * A page type: it recognizes no resource address, because the watch views
 * the operator's console rather than a workspace resource, and is opened
 * by kind. The guide page offers it as an entry box.
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from './locales.ts'

/** The tab kind this package owns. */
export const WATCH_KIND = 'redteam-watch'

/** This implementation's identity in the tab system, and the key its body registers under. */
export const WATCH_ID = '@deepseek-ai/dsh-client-ui-redteam-console/watch'

/**
 * The watch type's registry definition.
 * @param t - namespace-bound translate, read fresh on every title call.
 * @returns the definition to register.
 */
export function watchDefinition(t: TranslateNS<'redteamConsole'>): SidebarRightTabDefinition {
  return {
    id: WATCH_ID,
    kind: WATCH_KIND,
    priority: 'builtin',
    title: () => t('tab.watch.title'),
    guide: [{
      id: 'watch',
      order: 40,
      title: () => t('guide.watch.title'),
      description: () => t('guide.watch.description'),
    }],
  }
}
