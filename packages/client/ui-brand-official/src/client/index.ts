/** Official SecScan RedTeam occupants for the generic browser-brand slots. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { OfficialBrandMark, OfficialBrandName, OfficialHeroBrandMark } from './Brand.tsx'

/** Required service: the UI slot registry. */
export const inject = ['slots']

/**
 * Fill the sidebar brand slots as one declaration-aware registration set, and
 * seat the diamond in the conversation hero as well. Registration is not
 * gated on the client build profile: this package is composed only into
 * SecScan RedTeam builds, so every build that loads it — the packaged
 * official build and the local build alike — renders the official mark and
 * name. A deployment with its own identity leaves this package out of its
 * bundle and composes another brand package instead.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', function* () {
      yield ctx.slots.register({ name: 'sidebar.brand.mark' }, OfficialBrandMark)
      yield ctx.slots.register({ name: 'sidebar.brand.name' }, OfficialBrandName)
    }))
  ctx.slots.inject('conversation.hero.brand.mark', function* () {
    yield ctx.slots.register({ name: 'conversation.hero.brand.mark' }, OfficialHeroBrandMark)
  })
}
