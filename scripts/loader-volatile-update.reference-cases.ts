/** In-place volatile commits that retain every config reference and its lifecycle. */

import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Config } from './volatile-config.fixture.ts'
import { mountEntry, runtimeContext, update } from './loader-volatile-update.fixtures.ts'

describe('volatile Loader updates', () => {
  it('updates a whole-config reference and reports the root path', async () => {
    const ctx = await runtimeContext()
    const Config = z.object({ title: z.string() }).volatile()
    const events = vi.fn()
    const fiber = await mountEntry(ctx, { Config, apply(owner: Context) {
      owner.on('loader/volatile-update', events)
    } }, { title: 'first' })
    const reference = fiber.config as ReturnType<typeof Config>
    await update(fiber, { title: 'second' })
    expect(fiber.config).toBe(reference)
    expect(reference.get()).toEqual({ title: 'second' })
    expect(events).toHaveBeenCalledExactlyOnceWith([[]])
  })
  it('commits all references before one local event without remounting', async () => {
    const ctx = await runtimeContext()
    const configs: ReturnType<typeof Config>[] = []
    const observed: unknown[] = []
    const mount = vi.fn(function (owner: Context, config: ReturnType<typeof Config>) {
      configs.push(config)
      owner.on('loader/volatile-update', paths => observed.push({ paths, title: config.title.get(), count: config.nested.count.get() }))
    })
    const first = await mountEntry(ctx, { Config, apply: mount }, {})
    await mountEntry(ctx, { Config, apply: mount }, {})
    const initial = configs[0]!
    const title = initial.title
    await update(first, { title: 'hello' })
    expect(observed).toEqual([])
    await update(first, { title: 'next', nested: { count: 2 } })
    await first.await()
    expect(mount).toHaveBeenCalledTimes(2)
    expect(first.config).toBe(initial)
    expect(initial.title).toBe(title)
    expect(configs[1]!.title.get()).toBe('hello')
    expect(observed).toEqual([{ paths: [['title'], ['nested', 'count']], title: 'next', count: 2 }])
    await update(first, { title: 'next', nested: { count: 2 } })
    expect(observed).toHaveLength(1)
    await update(first, { optional: 'added' })
    expect(initial.optional.get()).toBe('added')
    await update(first, {})
    expect(initial.optional.get()).toBeUndefined()
  })

  it('keeps references on invalid updates and replaces them on mixed updates', async () => {
    const ctx = await runtimeContext()
    const notifications = vi.fn()
    const disposed = vi.fn()
    const configs: ReturnType<typeof Config>[] = []
    const plugin = { Config, apply(owner: Context, config: ReturnType<typeof Config>) {
      configs.push(config)
      owner.on('loader/volatile-update', notifications)
      owner.effect(() => disposed)
    } }
    const fiber = await mountEntry(ctx, plugin, {})
    const before = configs[0]!
    await update(fiber, { title: 'invalid candidate', nested: { count: -1 } })
    expect(before.title.get()).toBe('hello')
    expect(notifications).not.toHaveBeenCalled()
    await update(fiber, { title: 'new', fixed: 'restart' })
    await fiber.await()
    expect(configs).toHaveLength(2)
    expect(disposed).toHaveBeenCalledOnce()
    expect(notifications).not.toHaveBeenCalled()
    expect(before.title.get()).toBe('hello')
    expect(configs[1]!.title.get()).toBe('new')
    expect(configs[1]!.title).not.toBe(before.title)
  })

  it('bypasses custom update hooks for volatile changes and retains them for mixed changes', async () => {
    const ctx = await runtimeContext()
    const hooks: string[] = []
    const globalHook = vi.fn((_config: unknown, _noSave: boolean, next: () => void) => { next() })
    ctx.on('internal/update', globalHook, { global: true })
    const fiber = await mountEntry(ctx, { Config, apply(owner: Context) {
      owner.on('internal/update', (config: ReturnType<typeof Config>) => {
        hooks.push(config.title.get())
      })
    } }, {})
    const initial = fiber.config as ReturnType<typeof Config>
    await update(fiber, { title: 'accepted' })
    expect(fiber.config).toBe(initial)
    expect(initial.title.get()).toBe('accepted')
    await update(fiber, { title: 'accepted' })
    expect(hooks).toEqual([])
    expect(globalHook).not.toHaveBeenCalled()
    await update(fiber, { title: 'custom', fixed: 'changed' })
    expect(hooks).toEqual(['custom'])
    expect(initial.title.get()).toBe('accepted')
  })

  it('compares ordinary dates and arrays and retains the existing nonvolatile restart behavior', async () => {
    const ctx = await runtimeContext()
    const schema = z.object({ live: z.string().volatile(), date: z.date(), list: z.array(z.string()) })
    const apply = vi.fn(function () {})
    const fiber = await mountEntry(ctx, { Config: schema, apply }, { live: 'a', date: '2026-01-01', list: ['a'] })
    await update(fiber, { live: 'b', date: '2026-01-01', list: ['a'] })
    await fiber.await()
    expect(apply).toHaveBeenCalledOnce()
    await update(fiber, { live: 'c', date: '2026-01-02', list: ['a'] })
    await fiber.await()
    expect(apply).toHaveBeenCalledTimes(2)
    await update(fiber, { live: 'd', date: '2026-01-02', list: ['b'] })
    await fiber.await()
    expect(apply).toHaveBeenCalledTimes(3)
    const ordinary = await mountEntry(ctx, { Config: z.object({ value: z.string() }), apply() { apply() } }, { value: 'same' })
    ordinary.update({ value: 'same' })
    await ordinary.await()
    expect(apply).toHaveBeenCalledTimes(5)
  })

  it('resolves pending updates and creates fresh references after dependency replacement', async () => {
    const ctx = await runtimeContext()
    const configs: ReturnType<typeof Config>[] = []
    const consumer = await mountEntry(ctx, { Config, inject: ['volatile-test-provider'], apply(_ctx: Context, config: ReturnType<typeof Config>) {
      configs.push(config)
    } }, {})
    await update(consumer, { title: 'pending' })
    const provider = await ctx.plugin({ apply(owner: Context) { owner.provide('volatile-test-provider', {}) } })
    await consumer.await()
    expect(configs[0]!.title.get()).toBe('pending')
    await update(consumer, { title: 'live' })
    await provider.dispose()
    const before = configs[0]!.title
    await ctx.plugin({ apply(owner: Context) { owner.provide('volatile-test-provider', {}) } })
    await consumer.await()
    expect(configs).toHaveLength(2)
    expect(configs[1]!.title.get()).toBe('live')
    expect(configs[1]!.title).not.toBe(before)
  })

  it('remounts for changed class instances and cyclic ordinary config', async () => {
    const ctx = await runtimeContext()
    const schema = z.object({
      live: z.string().volatile(),
      url: z.transform(z.string(), value => new URL(value)),
      data: z.transform(z.string(), () => { const data: Record<string, unknown> = {}; data.self = data; return data }),
    })
    const apply = vi.fn(function () {})
    const oldUrl = 'https://a.example/'
    const newUrl = 'https://b.example/'
    const fiber = await mountEntry(ctx, { Config: schema, apply }, { live: 'a', url: oldUrl })
    const before = fiber.config as ReturnType<typeof schema>
    await update(fiber, { live: 'b', url: newUrl })
    await fiber.await()
    expect(apply).toHaveBeenCalledTimes(2)
    expect((fiber.config as ReturnType<typeof schema>).url.href).toBe(newUrl)
    expect(before.live.get()).toBe('a')
    await update(fiber, { live: 'c', url: newUrl, data: 'first' })
    await update(fiber, { live: 'd', url: newUrl, data: 'second' })
    expect(apply).toHaveBeenCalledTimes(4)
  })

  it('distinguishes undefined from null inside volatile arrays', async () => {
    const ctx = await runtimeContext()
    const schema = z.object({ values: z.array(z.any()).volatile() })
    const events = vi.fn()
    const fiber = await mountEntry(ctx, { Config: schema, apply(owner: Context) {
      owner.on('loader/volatile-update', events)
    } }, { values: [undefined] })
    await update(fiber, { values: [null] })
    expect((fiber.config as ReturnType<typeof schema>).values.get()).toEqual([null])
    expect(events).toHaveBeenCalledExactlyOnceWith([['values']])
  })
})
