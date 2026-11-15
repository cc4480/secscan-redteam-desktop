/** Cordis context and Loader entry helpers shared by the volatile-update cases. */

import { onTestFinished } from 'vitest'
import { Context, type Fiber, type Plugin } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'

/**
 * Creates a bare Context and disposes its fiber when the test finishes.
 * @returns the fresh context.
 */
export function context(): Context {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  return ctx
}

/**
 * Creates a Context with the Loader plugin mounted.
 * @returns the context owning the loader.
 */
export async function runtimeContext() {
  const ctx = context()
  await ctx.plugin(Loader)
  return ctx
}

/**
 * Registers one builtin plugin and mounts it as a Loader entry.
 * @param ctx - context owning the loader.
 * @param plugin - builtin plugin to mount.
 * @param config - raw entry config.
 * @returns the fiber of the mounted entry.
 */
export async function mountEntry(ctx: Context, plugin: Plugin, config: unknown = {}): Promise<Fiber> {
  const name = `consumer-${Object.keys(ctx.loader.builtins).length}`
  ctx.loader.builtins[name] = plugin
  const id = await ctx.loader.create({ name: `cordis:${name}`, config })
  const fiber = ctx.loader.resolve(id).fiber
  if (!fiber) throw new Error(`entry ${id} has no fiber`)
  await fiber.await()
  return fiber
}

/**
 * Updates one entry's config through its loader entry and settles the fiber.
 * @param fiber - fiber of the entry to update.
 * @param config - new raw config.
 * @returns a promise settling once the update completes.
 */
export async function update(fiber: Fiber, config: unknown): Promise<void> {
  const entry = fiber.entry
  if (!entry) throw new Error('fiber has no entry to update')
  await entry.update({ config })
  await fiber.await()
}
