/** Invalid candidates, expressions, transforms and listeners across volatile commits. */

import { expect, it, onTestFinished, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Config } from './volatile-config.fixture.ts'
import { mountEntry, runtimeContext, update } from './loader-volatile-update.fixtures.ts'

it('logs an invalid candidate and keeps its references while other entries commit', async () => {
  const ctx = await runtimeContext()
  const events = vi.fn()
  const plugin = { Config, apply(owner: Context) { owner.on('loader/volatile-update', events) } }
  const invalid = await mountEntry(ctx, plugin)
  const healthy = await mountEntry(ctx, plugin)
  const warning = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
  onTestFinished(() => { warning.mockRestore() })
  await invalid.entry!.update({ config: { title: 'invalid', nested: { count: -1 } } })
  await healthy.entry!.update({ config: { title: 'healthy' } })
  expect(warning).toHaveBeenCalledTimes(2)
  expect((invalid.config as ReturnType<typeof Config>).title.get()).toBe('hello')
  expect(invalid._config).toEqual({ title: 'invalid', nested: { count: -1 } })
  expect((healthy.config as ReturnType<typeof Config>).title.get()).toBe('healthy')
  expect(events).toHaveBeenCalledExactlyOnceWith([['title']])
})

it.each([false, true])('retains raw expression edits for dependency restoration (volatile: %s)', async (volatile) => {
  const ctx = await runtimeContext()
  const schema = z.object({ value: volatile ? z.string().volatile() : z.string() })
  const values: unknown[] = []
  const provide = (a: string, b: string) => ctx.plugin({ apply(owner: Context) { owner.provide('volatile-expression-source', { a, b }) } })
  const provider = await provide('same', 'same')
  const fiber = await mountEntry(ctx, { Config: schema, inject: ['volatile-expression-source'], apply(_owner: Context, config: ReturnType<typeof schema>) {
    values.push(typeof config.value === 'string' ? config.value : config.value.get())
  } }, { value: { __jsExpr: "ctx.get('volatile-expression-source').a" } })
  const raw = { value: { __jsExpr: "ctx.get('volatile-expression-source').b" } }
  await fiber.entry!.update({ config: raw })
  await fiber.await()
  expect(values).toEqual(volatile ? ['same'] : ['same', 'same'])
  expect(fiber._config).toBe(raw)
  await provider.dispose()
  await provide('old-route', 'new-route')
  await fiber.await()
  expect(values).toEqual(volatile ? ['same', 'new-route'] : ['same', 'same', 'new-route'])
})

it('remounts when changed expressions resolve to ordinary values different from the live config', async () => {
  const ctx = await runtimeContext()
  const source = { a: 'initial', b: 'initial' }
  ctx.provide('volatile-expression-source', source)
  const configs: ReturnType<typeof Config>[] = []
  const events = vi.fn()
  const fiber = await mountEntry(ctx, { Config, apply(owner: Context, config: ReturnType<typeof Config>) {
    configs.push(config)
    owner.on('loader/volatile-update', events)
  } }, { fixed: { __jsExpr: "ctx.get('volatile-expression-source').a" }, title: 'old' })
  source.a = source.b = 'changed'
  await update(fiber, { fixed: { __jsExpr: "ctx.get('volatile-expression-source').b" }, title: 'new' })
  expect(configs).toHaveLength(2)
  expect(configs[0]!.title.get()).toBe('old')
  expect(configs[1]!.fixed).toBe('changed')
  expect(configs[1]!.title.get()).toBe('new')
  expect(events).not.toHaveBeenCalled()
})

it('compares ordinary URL transforms by value and remounts when an expression result changes', async () => {
  const ctx = await runtimeContext()
  const source = { value: 'initial' }
  ctx.provide('volatile-transform-source', source)
  const schema = z.object({
    url: z.transform(z.string(), value => new URL(value), true),
    fixed: z.string(),
    live: z.string().volatile(),
  })
  const events = vi.fn()
  const mount = vi.fn(function (owner: Context) { owner.on('loader/volatile-update', events) })
  const fixed = { __jsExpr: "ctx.get('volatile-transform-source').value" }
  const raw = { url: 'https://example.com/', fixed, live: 'old' }
  const fiber = await mountEntry(ctx, { Config: schema, apply: mount }, raw)
  const current = fiber.config as ReturnType<typeof schema>
  await update(fiber, { ...raw, live: 'new' })
  expect(mount).toHaveBeenCalledOnce()
  expect(fiber.config).toBe(current)
  expect(current.url.href).toBe(raw.url)
  expect(current.fixed).toBe('initial')
  expect(current.live.get()).toBe('new')
  expect(events).toHaveBeenCalledExactlyOnceWith([['live']])
  source.value = 'changed'
  await update(fiber, { ...raw, live: 'remounted' })
  expect(mount).toHaveBeenCalledTimes(2)
  expect(current.fixed).toBe('initial')
  expect(current.live.get()).toBe('new')
  expect(events).toHaveBeenCalledOnce()
  const replaced = fiber.config as ReturnType<typeof schema>
  expect(replaced.fixed).toBe('changed')
  expect(replaced.live.get()).toBe('remounted')
})

it('remounts when an ordinary parent expression removes a live reference path', async () => {
  const ctx = await runtimeContext()
  const source: { block: { value: string } | undefined } = { block: { value: 'old' } }
  ctx.provide('volatile-path-source', source)
  const schema = z.object({ block: z.object({ value: z.string().volatile() }).extra('default', undefined), live: z.string().volatile() })
  const events = vi.fn()
  const mount = vi.fn(function (owner: Context) { owner.on('loader/volatile-update', events) })
  const raw = { block: { __jsExpr: "ctx.get('volatile-path-source').block" }, live: 'old' }
  const fiber = await mountEntry(ctx, { Config: schema, apply: mount }, raw)
  const current = fiber.config as ReturnType<typeof schema>
  source.block = undefined
  await update(fiber, { ...raw, live: 'new' })
  expect(mount).toHaveBeenCalledTimes(2)
  expect(current.block.value.get()).toBe('old')
  expect(events).not.toHaveBeenCalled()
  expect((fiber.config as ReturnType<typeof schema>).block).toBeUndefined()
})

it('keeps an ordinary plugin mounted when an absent object becomes its explicit default', async () => {
  const ctx = await runtimeContext()
  const Config = z.object({ nested: z.object({ fixed: z.string() }).default({ fixed: 'default' }) })
  const mount = vi.fn()
  const fiber = await mountEntry(ctx, { Config, apply: mount }, {})
  const config: unknown = fiber.config
  await update(fiber, { nested: { fixed: 'default' } })
  expect(fiber.config).toBe(config)
  expect(mount).toHaveBeenCalledTimes(1)
  await update(fiber, { nested: { fixed: 'changed' } })
  expect(mount).toHaveBeenCalledTimes(2)
  expect(fiber.config).toEqual({ nested: { fixed: 'changed' } })
})

it('keeps a noSave volatile value as the pending raw config across a no-op entry update', async () => {
  const ctx = await runtimeContext()
  const fiber = await mountEntry(ctx, { Config, apply() {} }, { title: 'saved' })
  fiber.update({ title: 'ephemeral' }, true)
  await fiber.await()
  expect((fiber.config as ReturnType<typeof Config>).title.get()).toBe('ephemeral')
  expect(fiber.entry!.options.config).toEqual({ title: 'saved' })
  await fiber.entry!.update({ config: { title: 'saved' } })
  expect(fiber._config).toEqual({ title: 'ephemeral' })
  expect((fiber.config as ReturnType<typeof Config>).title.get()).toBe('ephemeral')
})

it('isolates a failing notification listener and dispatches with a Context receiver', async () => {
  const ctx = await runtimeContext()
  const receivers: unknown[] = []
  const fiber = await mountEntry(ctx, { Config, apply(owner: Context) {
    owner.on('loader/volatile-update', function (this: Context) { receivers.push(this.fiber); throw new Error('listener boom') })
  } }, {})
  const other = await mountEntry(ctx, { Config, apply() {} }, {})
  const warning = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
  onTestFinished(() => { warning.mockRestore() })
  await update(fiber, { title: 'committed' })
  expect((fiber.config as ReturnType<typeof Config>).title.get()).toBe('committed')
  expect(receivers).toEqual([fiber])
  expect(warning).toHaveBeenCalledWith(expect.objectContaining({ message: 'listener boom' }))
  await update(other, { title: 'unaffected' })
  expect((other.config as ReturnType<typeof Config>).title.get()).toBe('unaffected')
})

it('remounts instead of committing when an ordinary field parses into a fresh class instance', async () => {
  const ctx = await runtimeContext()
  class Handle { constructor(public readonly name: string) {} }
  const schema = z.object({ handle: z.transform(z.string(), value => new Handle(value)), live: z.string().volatile() })
  const mount = vi.fn()
  const fiber = await mountEntry(ctx, { Config: schema, apply: mount }, { handle: 'h', live: 'old' })
  const before = fiber.config as ReturnType<typeof schema>
  await update(fiber, { handle: 'h', live: 'new' })
  expect(mount).toHaveBeenCalledTimes(2)
  expect(before.live.get()).toBe('old')
  expect((fiber.config as ReturnType<typeof schema>).live.get()).toBe('new')
})
