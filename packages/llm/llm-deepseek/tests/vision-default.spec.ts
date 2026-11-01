/** Absence default for model input modalities: silence resolves as image-capable. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { AttachmentId, ImageVariantId } from '@deepseek-ai/dsh-attachment'
import type { AttachmentStore, ImageAttachmentRef, RequestImageAttachment } from '@deepseek-ai/dsh-attachment'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ImageBlock } from '@deepseek-ai/dsh-llm'
import type { AnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import { DeepSeekAdapter, DeepSeekFileStore, resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek'
import type { PreparedDeepSeekLlmApiExtensions } from '@deepseek-ai/dsh-deepseek-llm-api-extensions'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'
import { requestImageStore } from './helpers.ts'

const TEST_USER_ID = '00000000-0000-4000-8000-000000000001' as AnonymousUserId
let testHome: string

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), 'dsh-llm-deepseek-vision-'))
  vi.stubEnv('DSH_HOME', testHome)
})

afterEach(async () => {
  await closeMockServers()
  vi.unstubAllEnvs()
  rmSync(testHome, { recursive: true, force: true })
})

function noExtensions(): Promise<PreparedDeepSeekLlmApiExtensions> {
  return Promise.resolve({ fields: {}, accept: () => Promise.resolve() })
}

/** Direct adapter over the plugin's real resolve step, with a static key. */
function adapterOf(
  config: Partial<LlmDeepSeek.Options> & { apiKey?: string } = {},
  attachments?: AttachmentStore,
): DeepSeekAdapter {
  const { apiKey, ...rest } = config
  const files = new DeepSeekFileStore()
  return new DeepSeekAdapter({
    options: () => resolveAdapterOptions({ ...rest }),
    resolveApiKey: () => Promise.resolve(apiKey ?? 'k'),
    resolveUserId: () => TEST_USER_ID,
    resolveAttachments: () => attachments,
    resolveFiles: () => files,
    prepareExtensions: noExtensions,
  })
}

async function drain(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const _chunk of stream) { /* drain */ }
}

const imageRef: ImageAttachmentRef = {
  attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
  mediaType: 'image/png',
  bytes: 3,
  width: 1,
  height: 1,
}

function requestImage(ref = imageRef): RequestImageAttachment {
  return {
    variantId: ImageVariantId(`sha256:${'b'.repeat(64)}`),
    attachment: ref,
    data: Uint8Array.of(1, 2, 3),
    mediaType: 'image/png',
    bytes: 3,
    width: 1,
    height: 1,
    depth: 'uchar',
    space: 'srgb',
    hasAlpha: true,
  }
}

function attachmentStoreOf(
  project: (ref: ImageAttachmentRef) => Promise<RequestImageAttachment>,
): {
  store: AttachmentStore
  readImageRequest: ReturnType<typeof vi.fn<typeof project>>
} {
  const readImageRequest = vi.fn(project)
  return {
    store: requestImageStore(readImageRequest),
    readImageRequest,
  }
}

const imageMessage = () => createUserMessage({
  source: { kind: 'user' },
  content: [{ type: 'image', attachment: imageRef }],
})

describe('vision absence default', () => {
  it('reports a silent catalog entry as text+image through discovery and resolution', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmDeepSeek, { baseURL: 'http://127.0.0.1:1', models: [{ id: 'hand-declared' }] })
    await expect(ctx.llm.listModels('deepseek-official')).resolves.toEqual([
      { provider: 'deepseek-official', id: 'hand-declared', name: 'hand-declared', inputModalities: ['text', 'image'] },
    ])
    await expect(ctx.llm.resolveModelInfo('deepseek-official', 'hand-declared'))
      .resolves.toMatchObject({ inputModalities: ['text', 'image'] })
  })

  it('reports an uncatalogued model id as text+image', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmDeepSeek, { baseURL: 'http://127.0.0.1:1' })
    await expect(ctx.llm.resolveModelInfo('deepseek-official', 'never-listed'))
      .resolves.toMatchObject({ inputModalities: ['text', 'image'] })
  })

  it('honors an explicit text-only declaration verbatim', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmDeepSeek, {
      baseURL: 'http://127.0.0.1:1',
      models: [{ id: 'declared-text', inputModalities: ['text'] }],
    })
    await expect(ctx.llm.listModels('deepseek-official')).resolves.toEqual([
      { provider: 'deepseek-official', id: 'declared-text', name: 'declared-text', inputModalities: ['text'] },
    ])
    await expect(ctx.llm.resolveModelInfo('deepseek-official', 'declared-text'))
      .resolves.toMatchObject({ inputModalities: ['text'] })
  })

  it('puts an attached image on the wire for a silent model', async () => {
    const server = await mockServer([{ kind: 'sse', events: textEvents }])
    const attachments = attachmentStoreOf(ref => Promise.resolve(requestImage(ref)))
    const adapter = adapterOf({ baseURL: server.url, models: [{ id: 'hand-declared' }] }, attachments.store)
    await drain(adapter.stream({
      provider: 'deepseek-official', model: 'hand-declared', messages: [imageMessage()],
    }))
    expect(attachments.readImageRequest).toHaveBeenCalledTimes(1)
    expect(server.fileRequests).toHaveLength(1)
    const body = server.requests[0] as { messages: Array<{ content: unknown }> }
    const wire = JSON.stringify(body.messages[0]?.content)
    expect(wire).toContain('"type":"image"')
    expect(wire).toContain('"file_id"')
  })

  it('still refuses an image for an explicitly text-only model before any request', async () => {
    const server = await mockServer([{ kind: 'sse', events: textEvents }])
    const attachments = attachmentStoreOf(ref => Promise.resolve(requestImage(ref)))
    const adapter = adapterOf({
      baseURL: server.url,
      models: [{ id: 'declared-text', inputModalities: ['text'] }],
    }, attachments.store)
    await expect(drain(adapter.stream({
      provider: 'deepseek-official', model: 'declared-text', messages: [imageMessage()],
    }))).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
    expect(attachments.readImageRequest).not.toHaveBeenCalled()
    expect(server.fileRequests).toHaveLength(0)
    expect(server.requests).toHaveLength(0)
  })

  it('prices retained images as visual for a silent model and as text for a declared text-only model', () => {
    const image: ImageBlock = { type: 'image', attachment: imageRef }
    const silent = adapterOf({ models: [{ id: 'hand-declared' }] })
    expect(silent.imageRequestPricing('deepseek-official', 'hand-declared')
      .priceImages([image])[0]?.visualTokens).toBeGreaterThan(0)
    const declared = adapterOf({ models: [{ id: 'declared-text', inputModalities: ['text'] }] })
    expect(declared.imageRequestPricing('deepseek-official', 'declared-text')
      .priceImages([image])[0]?.visualTokens).toBe(0)
  })
})
