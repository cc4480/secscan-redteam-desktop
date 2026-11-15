/** Loader entry updates: in-place commits, the config hook, isolation and profile patches. */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it, onTestFinished, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Config } from './volatile-config.fixture.ts'
import { boot, reconcileProfilePatches } from '@deepseek-ai/dsh-app-boot'
import { mountEntry, runtimeContext, update } from './loader-volatile-update.fixtures.ts'

it('commits volatile edits in place and retains direct Fiber updates', async () => {
  const ctx = await runtimeContext()
  const notifications = vi.fn()
  const apply = vi.fn(function (owner: Context) { owner.on('loader/volatile-update', notifications) })
  const fiber = await mountEntry(ctx, { Config, apply }, {})
  const original = fiber.config as ReturnType<typeof Config>
  await ctx.loader.create({ name: 'cordis:disabled', disabled: true })
  await update(fiber, { title: 'enabled' })
  expect(apply).toHaveBeenCalledOnce()
  expect(fiber.config).toBe(original)
  expect(original.title.get()).toBe('enabled')
  expect(notifications).toHaveBeenCalledExactlyOnceWith([['title']])
  await update(fiber, { title: 'invalid', nested: { count: -1 } })
  expect(original.title.get()).toBe('enabled')
  await update(fiber, { title: 'mixed', fixed: 'changed' })
  expect(apply).toHaveBeenCalledTimes(2)
  expect(original.title.get()).toBe('enabled')
  const current = fiber.config as ReturnType<typeof Config>
  expect(current.title.get()).toBe('mixed')

  const hook = vi.fn((_config: unknown, _noSave: boolean, next: () => void) => { next() })
  fiber.ctx.on('internal/update', hook)
  fiber.update({ title: 'direct' })
  await fiber.await()
  expect(hook).toHaveBeenCalledOnce()
  expect(apply).toHaveBeenCalledTimes(3)
  expect(current.title.get()).toBe('mixed')
  expect(notifications).toHaveBeenCalledOnce()
})

it('parses a volatile-only update through the config hook without patching the entry context', async () => {
  const ctx = await runtimeContext()
  const trace: string[] = []
  const trim = vi.fn((value: string) => { trace.push('validate'); return value.trim() })
  const Config = z.object({ block: z.object({ title: z.transform(z.string(), trim, true) }).volatile() })
  const fiber = await mountEntry(ctx, { Config, apply(owner: Context) {
    owner.on('loader/volatile-update', () => { trace.push('notify') })
  } }, { block: { title: 'initial' } })
  const current = fiber.config as ReturnType<typeof Config>
  const resolveHook = vi.fn((_raw: unknown, next: () => unknown) => next())
  fiber.ctx.on('internal/config', resolveHook)
  const contextPatch = vi.fn((_entry: unknown, next: () => void) => { next() })
  ctx.on('loader/patch-context', contextPatch)
  trim.mockClear()
  trace.length = 0
  const raw = { block: { title: ' changed ' } }
  await fiber.entry!.update({ config: raw })
  expect(contextPatch).not.toHaveBeenCalled()
  expect(trim).toHaveBeenCalledExactlyOnceWith(' changed ')
  expect(resolveHook).toHaveBeenCalledOnce()
  expect(trace).toEqual(['validate', 'notify'])
  expect(current.block.get()).toEqual({ title: 'changed' })
  expect(fiber._config).toBe(raw)
})

it.each([true, false])('keeps old references untouched when isolation replaces a dependency (available: %s)', async (available) => {
  const ctx = await runtimeContext()
  const configs: ReturnType<typeof Config>[] = []
  const notifications = vi.fn()
  ctx.loader.builtins.provider = { apply(owner: Context) { owner.provide('volatile-isolated-service', {}) } }
  ctx.loader.builtins.consumer = {
    inject: ['volatile-isolated-service'], Config,
    apply(owner: Context, config: ReturnType<typeof Config>) {
      configs.push(config)
      owner.on('loader/volatile-update', notifications)
    },
  }
  const provider = (realm: string) => ctx.loader.create({
    name: 'cordis:provider', isolate: { 'volatile-isolated-service': realm },
  })
  await provider('a')
  if (available) await provider('b')
  const id = await ctx.loader.create({
    name: 'cordis:consumer', isolate: { 'volatile-isolated-service': 'a' }, config: { title: 'old' },
  })
  await ctx.loader.await()
  const original = configs[0]!
  await ctx.loader.resolve(id).update({ isolate: { 'volatile-isolated-service': 'b' }, config: { title: 'new' } })
  await ctx.loader.await()
  expect(configs).toHaveLength(available ? 2 : 1)
  expect(original.title.get()).toBe('old')
  expect(notifications).not.toHaveBeenCalled()
  if (!available) {
    await provider('b')
    await ctx.loader.await()
  }
  expect(configs).toHaveLength(2)
  expect(configs[1]!.title.get()).toBe('new')
})

it.each(['group', 'include'] as const)('applies profile patches to a %s subtree without HMR and keeps mixed updates on the normal lifecycle', async (kind) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-volatile-profile-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const configs: ReturnType<typeof Config>[] = []
  const events = vi.fn()
  const dispose = vi.fn()
  const consumer = { Config, apply(owner: Context, config: ReturnType<typeof Config>) {
    configs.push(config)
    owner.on('loader/volatile-update', events)
    owner.effect(() => dispose)
  } }
  const child = (title: string, fixed = 'fixed') => ({ id: 'consumer', name: 'cordis:consumer', config: { title, fixed } })
  const nested = join(root, 'nested.json')
  await writeFile(nested, JSON.stringify([child('initial')]))
  const carrierConfig = (title: string, fixed = 'fixed') => kind === 'group'
    ? [child(title, fixed)]
    : { path: pathToFileURL(nested).href, patches: [{ id: 'consumer', config: { title, fixed } }] }
  const filename = join(root, 'cordis.yml')
  await writeFile(filename, JSON.stringify([{ id: 'parent', name: `cordis:${kind}`, group: kind === 'group', config: carrierConfig('initial') }]))
  const ctx = await boot('volatile-test', filename, undefined, async (ctx) => {
    ctx.loader.builtins.consumer = consumer
  })
  onTestFinished(() => ctx.fiber.dispose())
  expect(ctx.get('hmr')).toBeUndefined()
  const parent = [...ctx.loader.entries()].find(entry => entry.options.id === 'parent')!
  const entry = [...ctx.loader.entries()].find(entry => entry.options.id === 'consumer')!
  const parentFiber = parent.fiber
  const childFiber = entry.fiber
  const original = configs[0]!
  const reference = original.title
  const patch = (title: string, fixed = 'fixed') => [{ id: 'parent', config: carrierConfig(title, fixed) }]
  await reconcileProfilePatches(ctx, patch('first'), 'volatile-test')
  await reconcileProfilePatches(ctx, patch('second'), 'volatile-test')
  expect(parent.fiber).toBe(parentFiber)
  expect(entry.fiber).toBe(childFiber)
  expect(entry.fiber!.config).toBe(original)
  expect(original.title).toBe(reference)
  expect(reference.get()).toBe('second')
  expect(configs).toHaveLength(1)
  expect(dispose).not.toHaveBeenCalled()
  expect(events).toHaveBeenCalledTimes(2)
  expect(events).toHaveBeenLastCalledWith([['title']])
  await reconcileProfilePatches(ctx, patch('second'), 'volatile-test')
  expect(events).toHaveBeenCalledTimes(2)
  await reconcileProfilePatches(ctx, patch('mixed', 'changed'), 'volatile-test')
  expect(parent.fiber).toBe(parentFiber)
  expect(configs).toHaveLength(2)
  expect(dispose).toHaveBeenCalledOnce()
  expect(reference.get()).toBe('second')
  expect(configs[1]!.title.get()).toBe('mixed')
  expect(events).toHaveBeenCalledTimes(2)
})
