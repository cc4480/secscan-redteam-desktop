/**
 * Inert providers and child-scope plumbing the boot manifest mounts so every
 * schema-producing consumer registers without executing anything.
 */

import { resolve } from 'node:path'
import { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentLimits, ImageAttachmentRef, SaveImageAttachment, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentProvider } from '@deepseek-ai/dsh-subagent'
import WorkflowEngine from '@deepseek-ai/dsh-workflow'
import type { WorkflowRun, WorkflowStartRequest } from '@deepseek-ai/dsh-workflow'

/** Attachment seam marker that makes the attachments-conditional `read_image` schema harvestable. */
export class CatalogAttachmentStore extends AttachmentStore {
  readonly imageLimits: ImageAttachmentLimits = Object.freeze({
    maxImageBytes: 1,
    maxImagesPerMessage: 1,
    maxMessageImageBytes: 1,
    maxImagePixels: 1,
    maxImageDimension: 1,
    mediaTypes: Object.freeze(['image/png'] as const),
  })

  override validateImage(_input: SaveImageAttachment): Promise<void> {
    return Promise.reject(new Error('gen-tool-catalog: attachment validation is unreachable during schema harvest'))
  }

  override saveImage(_input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    return Promise.reject(new Error('gen-tool-catalog: attachment writes are unreachable during schema harvest'))
  }

  override readImage(_ref: ImageAttachmentRef): Promise<StoredImageAttachment> {
    return Promise.reject(new Error('gen-tool-catalog: attachment reads are unreachable during schema harvest'))
  }
}

/** Repository root; every manifest recipe resolves its fixture paths against it. */
export const root = resolve(import.meta.dirname, '..')

/** Repo-relative path of the generated catalog. */
export const OUT = 'docs/tool-catalog.md'

/** Workflow tools expose their schemas without executing a program. */
export class CatalogWorkflowEngine extends WorkflowEngine {
  start(_request: WorkflowStartRequest): WorkflowRun {
    throw new Error('gen-tool-catalog: workflow execution is unavailable during schema harvest')
  }
}

/**
 * Register the descriptor needed to mount schema-producing consumers. Declares
 * the full capability set of the shipped in-process providers so consumers
 * mount under their shipped defaults (tool-subagent's default numeric maxDepth
 * requires `depthLimit`).
 */
export function registerCatalogSubagentProvider(ctx: Context, name: string): void {
  const provider: SubagentProvider = {
    name,
    capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
    inheritsParentContext: false,
    start: () => Promise.reject(new Error('tool-catalog provider cannot start a child')),
    // Declared so consumers configured for continuable background mode mount.
    prepareContinuable: () => Promise.reject(new Error('tool-catalog provider cannot prepare a child')),
  }
  ctx.subagents.registerProvider(provider)
}

/** Minted child-scope keys for packages whose tools are never global. */
export const catalogChildScopes = new WeakMap<Context, Agent>()

/**
 * Install one scope-local tool package into an agent-like child scope for
 * schema harvest, without starting a model, Agent loop, or persistence backend.
 * @param ctx - catalog context owning the scope.
 * @param mountScoped - package installer for the scoped context.
 * @param key - agent-like scope key exposed to the package's scope selector.
 * @param inject - services the package installer must await before mounting.
 */
export async function mountCatalogChildScope(
  ctx: Context,
  mountScoped: (childCtx: Context) => void,
  key: Agent = { id: SessionId('tool-catalog-child') } as Agent,
  inject: string[] = ['tools', 'systemPrompt', 'subagents'],
): Promise<void> {
  await ctx.plugin(Object.assign((inner: Context) => {
    mountScoped(createScope(inner, key).ctx)
  }, { inject }))
  catalogChildScopes.set(ctx, key)
}
