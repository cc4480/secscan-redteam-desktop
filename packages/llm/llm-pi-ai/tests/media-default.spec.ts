import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { AttachmentId, AttachmentStore, ImageVariantId } from '@deepseek-ai/dsh-attachment'
import type {
  FileAttachmentRef,
  ImageAttachmentLimits,
  ImageAttachmentRef,
  ImageRequestTarget,
  RequestImageAttachment,
  SaveImageAttachment,
  StoredImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { resolveProfiles } from '../src/config.ts'
import { assemble } from './assemble.ts'
import { memoryAuth } from './auth-double.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'test': { kind: 'test' } & ContextFormed
  }
}

// Routes name their credential by reference; the value lives in the
// environment, which is the layer the adapter falls back to without a
// mounted credentials seam.
const KEY_ENV = 'PI_TEST_KEY'

beforeEach(() => {
  vi.stubEnv(KEY_ENV, 'test-key')
  readImageRequest.mockClear()
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await closeMockServers()
})

const IMAGE_REF: ImageAttachmentRef = {
  attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
  mediaType: 'image/png',
  bytes: 1,
  width: 1,
  height: 1,
}
const HOST_IMAGE_PATH = '/host/.dsh/attachments/objects/aa/object'
const MODEL_IMAGE_PATH = '/model/.dsh/attachments/objects/aa/object'

const FILE_REF: FileAttachmentRef = {
  attachmentId: AttachmentId(`sha256:${'c'.repeat(64)}`),
  name: 'notes.pdf',
  bytes: 3,
}

const readImageRequest = vi.fn((
  value: ImageAttachmentRef,
  _target: ImageRequestTarget,
  _signal?: AbortSignal,
): Promise<RequestImageAttachment> => (
  Promise.resolve({
    variantId: ImageVariantId(`sha256:${'b'.repeat(64)}`),
    attachment: value,
    data: Uint8Array.of(1),
    mediaType: value.mediaType,
    bytes: 1,
    width: value.width,
    height: value.height,
    depth: 'uchar',
    space: 'srgb',
    hasAlpha: true,
  })
))

class MediaAttachmentStore extends AttachmentStore {
  readonly imageLimits: ImageAttachmentLimits = {
    maxImageBytes: 1,
    maxImagesPerMessage: 1,
    maxMessageImageBytes: 1,
    maxImagePixels: 1,
    maxImageDimension: 2000,
    mediaTypes: ['image/png'],
  }

  validateImage(_input: SaveImageAttachment): Promise<void> {
    return Promise.reject(new Error('not used'))
  }

  saveImage(_input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    return Promise.reject(new Error('not used'))
  }

  readImage(value: ImageAttachmentRef): Promise<StoredImageAttachment> {
    return Promise.resolve({ ref: value, data: Uint8Array.of(1) })
  }

  override imageHostPath(_ref: ImageAttachmentRef): string {
    return HOST_IMAGE_PATH
  }

  override readImageRequest(
    value: ImageAttachmentRef,
    policy: ImageRequestTarget,
    signal?: AbortSignal,
  ): Promise<RequestImageAttachment> {
    return readImageRequest(value, policy, signal)
  }
}

class MappedFileSystem extends Service {
  constructor(ctx: Context) {
    super(ctx, 'fs')
  }

  processPathFromHostPath(hostPath: string): string | undefined {
    return hostPath === HOST_IMAGE_PATH ? MODEL_IMAGE_PATH : undefined
  }
}

/**
 * The operator's Meta route as actually declared in the field: a hand-written
 * model entry naming only the id — no `input`, no route `defaultInput`.
 * @param baseURL - the mock provider endpoint.
 * @returns plugin options for the composition.
 */
function metaRoute(baseURL: string): LlmPiAi.Options {
  return {
    providers: {
      meta: {
        apiKeyEnv: KEY_ENV,
        api: 'openai-completions',
        baseURL,
        models: [{ id: 'muse-spark-1.3-contributor' }],
      },
    },
  }
}

async function harness(config: LlmPiAi.Options): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmPiAi, config)
  return ctx
}

describe('undeclared models and media input', () => {
  it('reports a hand-declared model with no input declaration as image-capable', async () => {
    const server = await mockServer([])
    const ctx = await harness(metaRoute(`${server.url}/v1`))

    // This is the exact value the session gate reads before admitting an
    // image part (`resolveModelInfo` in the session controller): `['text']`
    // here is what produced MODEL_DOES_NOT_SUPPORT_IMAGES for the operator.
    const info = await ctx.llm.resolveModelInfo('meta', 'muse-spark-1.3-contributor')
    expect(info.inputModalities).toEqual(['text', 'image'])
    expect(await ctx.llm.listModels('meta')).toEqual([
      {
        provider: 'meta',
        id: 'muse-spark-1.3-contributor',
        name: 'muse-spark-1.3-contributor',
        inputModalities: ['text', 'image'],
      },
    ])
  })

  it('carries an image part to the provider for the undeclared model', async () => {
    const server = await mockServer([{ events: textEvents }])
    const ctx = await harness(metaRoute(`${server.url}/v1`))
    await ctx.plugin(MediaAttachmentStore)
    await ctx.plugin(MappedFileSystem)

    const result = await assemble(ctx, {
      provider: 'meta',
      model: 'muse-spark-1.3-contributor',
      messages: [createUserMessage({
        content: [{ type: 'image', attachment: IMAGE_REF }],
        source: { kind: 'test' },
      })],
    })

    expect(result.finish).toEqual({ kind: 'stop' })
    expect(result.message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(server.paths).toEqual(['/v1/chat/completions'])
    expect(readImageRequest).toHaveBeenCalled()
    expect(JSON.stringify(server.requests[0])).toContain('image_url')
    // The conversion path does real request-image work; the default 5s test
    // budget is sized for the projection-only cases around it.
  }, 30_000)

  it('still honours an explicit text-only declaration on the same route shape', async () => {
    const server = await mockServer([{ events: textEvents }])
    const ctx = await harness({
      providers: {
        meta: {
          apiKeyEnv: KEY_ENV,
          api: 'openai-completions',
          baseURL: `${server.url}/v1`,
          models: [{ id: 'declared-text-only', input: ['text'] }],
        },
      },
    })
    await ctx.plugin(MediaAttachmentStore)
    await ctx.plugin(MappedFileSystem)

    // The declaration is reported verbatim — absence is what changed, not
    // explicitness. (At the session gate this same value is what produces
    // MODEL_DOES_NOT_SUPPORT_IMAGES for a declared text-only model.)
    const info = await ctx.llm.resolveModelInfo('meta', 'declared-text-only')
    expect(info.inputModalities).toEqual(['text'])

    const result = await assemble(ctx, {
      provider: 'meta',
      model: 'declared-text-only',
      messages: [createUserMessage({
        content: [{ type: 'image', attachment: IMAGE_REF }],
        source: { kind: 'test' },
      })],
    })
    // The image is never converted or sent natively: the shared runtime
    // projects it to placeholder text for the declared text-only model.
    expect(result.finish).toEqual({ kind: 'stop' })
    expect(readImageRequest).not.toHaveBeenCalled()
    expect(JSON.stringify(server.requests[0])).not.toContain('image_url')
    expect(JSON.stringify(server.requests[0])).not.toContain('data:image')
  })

  it('rejects an image at the adapter for an explicitly text-only model, before provider I/O', async () => {
    const adapter = new PiAiAdapter({
      profiles: () => resolveProfiles({
        meta: {
          apiKeyEnv: KEY_ENV,
          api: 'openai-completions',
          baseURL: 'https://meta.test/v1',
          models: [{ id: 'declared-text-only', input: ['text'] }],
        },
      }),
      resolveApiKey: () => Promise.resolve('test-key'),
      auth: memoryAuth(),
    })
    const drain = async (): Promise<void> => {
      for await (const _chunk of adapter.stream({
        provider: 'meta',
        model: 'declared-text-only',
        messages: [createUserMessage({
          content: [{ type: 'image', attachment: IMAGE_REF }],
          source: { kind: 'test' },
        })],
      })) { /* drain */ }
    }
    await expect(drain()).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
  })

  it('admits a file part to the undeclared model as handle text, never natively', async () => {
    const server = await mockServer([{ events: textEvents }])
    const ctx = await harness(metaRoute(`${server.url}/v1`))

    const result = await assemble(ctx, {
      provider: 'meta',
      model: 'muse-spark-1.3-contributor',
      messages: [createUserMessage({
        content: [{ type: 'file', attachment: FILE_REF }],
        source: { kind: 'test' },
      })],
    })

    expect(result.finish).toEqual({ kind: 'stop' })
    expect(server.paths).toEqual(['/v1/chat/completions'])
    expect(JSON.stringify(server.requests[0])).toContain('notes.pdf')
  })
})
