/** What the browser half registers, how it unwraps the Remote result, and that it all leaves with the fiber. */

import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { LocalModelActionResult, LocalModelDeleteResult, LocalModelPullStart, LocalModelPullStatus, LocalModelsStatus } from '@deepseek-ai/dsh-api-remotes/client'
import { apply, inject, NS } from '../src/client/index.ts'
import { LocalModelsSectionWithActions } from '../src/client/ModelActions.tsx'
import type { LocalModelsSectionInjected } from '../src/client/LocalModelsSection.tsx'
import { apply as hostApply } from '../src/index.ts'

// Like the ui-settings-plugins bench: the lane has no jsdom `window`, so a
// fresh LocaleRuntime opens on FALLBACK_LOCALE (en); bench stages zh
// explicitly on the locale instead.

type RemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

type StatusResult = RemoteResult<LocalModelsStatus>
type ActionResult = RemoteResult<LocalModelActionResult>
type DeleteResult = RemoteResult<LocalModelDeleteResult>
type PullStartResult = RemoteResult<LocalModelPullStart>
type PullStatusResult = RemoteResult<LocalModelPullStatus>

const PAYLOAD: LocalModelsStatus = {
  serving: 'ollama',
  endpoint: { up: true, baseUrl: 'http://127.0.0.1:11434' },
  models: [{ id: 'ornith-1.5:9b', loaded: true, contextLength: 4096 }],
  folderModels: [],
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  new RemoteService(ctx)
  const status = vi.fn<() => Promise<StatusResult>>()
    .mockResolvedValue({ ok: true, value: PAYLOAD })
  const startModel = vi.fn<(modelId: string) => Promise<ActionResult>>()
    .mockResolvedValue({ ok: true, value: { modelId: 'ornith-1.5:9b', loaded: true } })
  const stopModel = vi.fn<(modelId: string) => Promise<ActionResult>>()
    .mockResolvedValue({ ok: true, value: { modelId: 'ornith-1.5:9b', loaded: false } })
  const deleteModel = vi.fn<(modelId: string) => Promise<DeleteResult>>()
    .mockResolvedValue({ ok: true, value: { modelId: 'ornith-1.5:9b', deleted: true } })
  const startPull = vi.fn<(modelId: string) => Promise<PullStartResult>>()
    .mockResolvedValue({ ok: true, value: { jobId: 'job-1' } })
  const pullStatus = vi.fn<(jobId: string) => Promise<PullStatusResult>>()
    .mockResolvedValue({ ok: true, value: { jobId: 'job-1', modelId: 'ornith-1.5:9b', state: 'done' } })
  const listRepoFiles = vi.fn<(repo: string) => Promise<{ ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }>>()
    .mockResolvedValue({ ok: true, value: [{ file: 'model.Q4_K_M.gguf', sizeBytes: 123, isGguf: true }] })
  ctx.provide('remote.localModels', { status, startModel, stopModel, deleteModel, startPull, pullStatus, listRepoFiles })
  return { ctx, slots: ctx.get('slots') as SlotRegistry, status, startModel, stopModel, deleteModel, startPull, pullStatus, listRepoFiles }
}

/** The Settings shell's section slot, as its owner declares it. */
function declareRoot(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-settings-local-models apply', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.localModels'])
  })

  it('registers one Local models section at order 12 without reading the Remote eagerly', async () => {
    const { ctx, slots, status } = await bench()
    declareRoot(slots)

    await ctx.plugin({ inject: [...inject], apply }).await()

    const section = slots.entries('settings.section')[0]!
    expect(section.component).toBe(LocalModelsSectionWithActions)
    expect(section.options).toMatchObject({ id: 'local-models', order: 12 })
    expect(section.locale).toBe(NS)
    // The nav label is a locale-following thunk; owners resolve it at read time.
    expect(resolveSlotLabel(section.options.label)).toBe('æœ¬åœ°æ¨¡åž‹')
    expect(status).not.toHaveBeenCalled()
  })

  it('unwraps the Remote result through the injected loadStatus', async () => {
    const { ctx, slots, status } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()

    const section = slots.entries('settings.section')[0]!
    const injected = (section.inject as unknown as () => LocalModelsSectionInjected)()
    await expect(injected.loadStatus()).resolves.toEqual(PAYLOAD)
    expect(status).toHaveBeenCalledOnce()

    status.mockResolvedValueOnce({ ok: false, error: { code: 'REMOTE_ERROR', message: 'unavailable' } })
    await expect(injected.loadStatus()).rejects.toThrow('localModels.status failed: REMOTE_ERROR: unavailable')
  })

  it('unwraps the lifecycle actions through the injected face', async () => {
    const { ctx, slots, startModel, stopModel, deleteModel, startPull, pullStatus, listRepoFiles } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()

    const section = slots.entries('settings.section')[0]!
    const injected = (section.inject as unknown as () => LocalModelsSectionInjected)()
    await expect(injected.startModel('ornith-1.5:9b')).resolves.toEqual({ modelId: 'ornith-1.5:9b', loaded: true })
    expect(startModel).toHaveBeenCalledWith('ornith-1.5:9b')
    await expect(injected.stopModel('ornith-1.5:9b')).resolves.toEqual({ modelId: 'ornith-1.5:9b', loaded: false })
    expect(stopModel).toHaveBeenCalledWith('ornith-1.5:9b')
    await expect(injected.deleteModel('ornith-1.5:9b')).resolves.toEqual({ modelId: 'ornith-1.5:9b', deleted: true })
    expect(deleteModel).toHaveBeenCalledWith('ornith-1.5:9b')
    await expect(injected.startPull('ornith-1.5:9b')).resolves.toEqual({ jobId: 'job-1' })
    expect(startPull).toHaveBeenCalledWith('ornith-1.5:9b')
    await expect(injected.pullStatus('job-1')).resolves.toEqual({ jobId: 'job-1', modelId: 'ornith-1.5:9b', state: 'done' })
    expect(pullStatus).toHaveBeenCalledWith('job-1')
    await expect(injected.listRepoFiles('owner/repo'))
      .resolves.toEqual([{ file: 'model.Q4_K_M.gguf', sizeBytes: 123, isGguf: true }])
    expect(listRepoFiles).toHaveBeenCalledWith('owner/repo')

    startModel.mockResolvedValueOnce({
      ok: false,
      error: { code: 'LOCAL_OLLAMA_UNREACHABLE', message: 'endpoint is silent' },
    })
    await expect(injected.startModel('ornith-1.5:9b'))
      .rejects.toThrow('localModels.startModel failed: LOCAL_OLLAMA_UNREACHABLE: endpoint is silent')
  })

  it('registers into a declaration that arrives after apply', async () => {
    const { ctx, slots } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()

    declareRoot(slots)

    await vi.waitFor(() => { expect(slots.entries('settings.section')).toHaveLength(1) })
  })

  it('collapses the section on teardown', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(slots.entries('settings.section')).toHaveLength(1)

    await fiber.dispose()

    expect(slots.entries('settings.section')).toHaveLength(0)
  })
})
