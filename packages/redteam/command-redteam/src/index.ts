/**
 * Human-facing RedTeam slash commands for the SecScan RedTeam profile:
 * `/scan`, `/status`, `/report`, `/stop`, and `/use`, registered with the
 * harness command registry so the composer's existing `/` menu, keyboard
 * flow, and lifecycle logging carry them with no new client surface.
 * @module @secscan/redteam-command
 */

import type { Context } from '@deepseek-ai/cordis'
import { createRedteamCommandDefinitions } from './commands.js'

export const name = 'command-redteam'
export const inject = ['commands']

/**
 * Register the RedTeam commands for every composed command adapter.
 * @param ctx - context carrying the command registry.
 */
export function apply(ctx: Context): void {
  ctx.effect(function* () {
    for (const definition of createRedteamCommandDefinitions(ctx)) {
      yield ctx.commands.register(definition)
    }
  }, 'command-redteam lifecycle')
}
