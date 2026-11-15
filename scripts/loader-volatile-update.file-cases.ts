/** Volatile updates across a real config file, its Group and its Include subtree. */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader, { Group } from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import { Config } from './volatile-config.fixture.ts'
import Hmr from '@deepseek-ai/dsh-hmr'
import { context } from './loader-volatile-update.fixtures.ts'

it('reloads real YAML and persists plain values independently of custom update hooks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-volatile-'))
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  const configs: ReturnType<typeof Config>[] = []
  ctx.loader.builtins.include = Include
  ctx.loader.builtins.group = Group
  const updates = vi.fn()
  const consumer = { Config, apply(owner: Context, config: ReturnType<typeof Config>) {
    configs.push(config)
    owner.on('internal/update', updates)
  } }
  ctx.loader.builtins['volatile-test'] = consumer
  const filename = join(root, 'cordis.yml')
  await writeFile(filename, '- id: group\n  name: cordis:group\n  group: true\n  config:\n    - id: consumer\n      name: cordis:volatile-test\n      config:\n        title: initial\n')
  const rootId = await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(filename).href } })
  await ctx.loader.await()
  const include = ctx.loader.resolve(rootId).subtree as Include
  const group = include.store.group!.fiber!
  const groupUid = group.uid
  const entry = [...ctx.loader.entries()].find(entry => entry.options.id === 'consumer')!
  expect(configs[0]!.title.get()).toBe('initial')
  await ctx.plugin(Timer)
  // An exact-file config watch mirrors the HMR root-watch Include path, which packages/boot/hmr covers with a mocked watcher.
  await ctx.plugin(Hmr, { root: [], ignored: [], debounce: 0 })
  const stopWatching = await ctx.hmr.watchConfig(filename, async () => {
    await include.refresh()
    await ctx.loader.await()
  })
  await writeFile(filename, '- id: group\n  name: cordis:group\n  group: true\n  config:\n    - id: consumer\n      name: cordis:volatile-test\n      config:\n        title: file-update\n')
  // The config watcher stabilizes writes for two seconds before publishing a change.
  await vi.waitFor(() => { expect(configs[0]!.title.get()).toBe('file-update') }, { timeout: 10_000 })
  await stopWatching()
  expect(configs).toHaveLength(1)
  expect(include.store.group!.fiber).toBe(group)
  expect(group.uid).toBe(groupUid)
  expect(configs[0]!.title.get()).toBe('file-update')
  entry.fiber!.update({ title: 'program-update', group: { list: ['item'] } })
  expect(entry.options.config).toEqual({ title: 'program-update', group: { list: ['item'] } })
  entry.fiber!.update({ title: 'ephemeral' }, true)
  expect(entry.options.config).toEqual({ title: 'program-update', group: { list: ['item'] } })
  await ctx.fiber.dispose()
  const saved = await readFile(filename, 'utf8')
  expect(saved).toContain('program-update')
  expect(saved).not.toContain('get:')
  expect(saved).not.toContain('ephemeral')
  expect(updates).toHaveBeenCalledTimes(2)
  const restored = context()
  restored.baseUrl = ctx.baseUrl
  await restored.plugin(Loader)
  restored.loader.builtins.include = Include
  restored.loader.builtins.group = Group
  restored.loader.builtins['volatile-test'] = consumer
  await restored.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(filename).href } })
  await restored.loader.await()
  expect(configs).toHaveLength(2)
  expect(configs[1]!.title.get()).toBe('program-update')
  expect(configs[1]!.group.get()).toEqual({ list: ['item'] })
  await restored.fiber.dispose()
})

it('updates volatile children through Group and Include custom updates and saves ordinary config', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-volatile-tree-'))
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.builtins.group = Group
  const configs: ReturnType<typeof Config>[] = []
  const notifications = vi.fn()
  const childUpdates = vi.fn()
  ctx.loader.builtins['volatile-test'] = { Config, apply(owner: Context, config: ReturnType<typeof Config>) {
    configs.push(config)
    owner.on('loader/volatile-update', notifications)
    owner.on('internal/update', childUpdates)
  } }
  const child = (title: string) => ({ id: 'consumer', name: 'cordis:volatile-test', config: { title } })
  const filename = join(root, 'tree.json')
  const includePath = pathToFileURL(filename).href
  await writeFile(filename, JSON.stringify([{ id: 'group', name: 'cordis:group', group: true, config: [child('initial')] }]))
  const rootId = await ctx.loader.create({ name: 'cordis:include', config: { path: includePath } })
  await ctx.loader.await()
  const includeEntry = ctx.loader.resolve(rootId)
  const include = includeEntry.subtree as Include
  const group = include.store.group!
  const consumer = include.store.consumer!
  const originalInclude = includeEntry.fiber
  const originalGroup = group.fiber
  const originalConsumer = consumer.fiber
  const initial = configs[0]!

  group.fiber!.update([child('group-update')])
  await ctx.loader.await()
  expect(initial.title.get()).toBe('group-update')
  expect(group.options.config).toEqual([child('group-update')])
  includeEntry.fiber!.update({ path: includePath, patches: [{ id: 'consumer', config: { title: 'include-update' } }] })
  await ctx.loader.await()
  expect(initial.title.get()).toBe('include-update')
  expect(includeEntry.fiber).toBe(originalInclude)
  expect(group.fiber).toBe(originalGroup)
  expect(consumer.fiber).toBe(originalConsumer)
  expect(consumer.fiber!.config).toBe(initial)
  expect(configs).toHaveLength(1)
  expect(notifications).toHaveBeenCalledTimes(2)
  expect(childUpdates).not.toHaveBeenCalled()

  const ordinary = await ctx.loader.create({ name: 'cordis:volatile-test', config: {} })
  const entry = ctx.loader.resolve(ordinary)
  entry.fiber!.update({ title: 'custom-update', fixed: 'ordinary' })
  expect(childUpdates).toHaveBeenCalledOnce()
  expect(entry.options.config).toEqual({ title: 'custom-update', fixed: 'ordinary' })
  expect((entry.fiber!.config as ReturnType<typeof Config>).title.get()).toBe('hello')
  entry.fiber!.update({ title: 'ephemeral', fixed: 'ordinary' }, true)
  expect(childUpdates).toHaveBeenCalledTimes(2)
  expect(entry.options.config).toEqual({ title: 'custom-update', fixed: 'ordinary' })
  expect(() => { entry.fiber!.update({ nested: { count: -1 } }) }).toThrow()
  expect(childUpdates).toHaveBeenCalledTimes(2)
  expect(entry.options.config).toEqual({ title: 'custom-update', fixed: 'ordinary' })
})
