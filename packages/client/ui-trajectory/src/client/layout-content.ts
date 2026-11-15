/**
 * Content projection for a cell: source blocks from wire-shaped content, and the
 * preview, detail and result text a Message or Tool cell renders.
 */
import type { TrajectoryCellProps, TrajectorySourceBlock } from './trajectory-record.ts'
import type { FileAttachmentRef, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {
  AssistantBlock, RequestPromptChange, ToolResultNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TrajectoryTranslate } from './locales.ts'

export function imageBlockCount(content: readonly { type: string }[]): number {
  return content.filter(block => block.type === 'image').length
}

export function fileBlockCount(content: readonly { type: string }[]): number {
  return content.filter(block => block.type === 'file').length
}

function stringifySourceValue(value: unknown): string {
  const json = JSON.stringify(value, null, 2)
  return json || String(value)
}

export function sourceBlock(value: unknown): TrajectorySourceBlock {
  if (typeof value !== 'object' || value === null) {
    return { type: 'unknown', content: stringifySourceValue(value) }
  }
  const block = value as Record<string, unknown>
  const type = typeof block.type === 'string' ? block.type : 'unknown'
  if (typeof block.text === 'string') {
    return { type: type === 'reasoning' ? 'thinking' : type, content: block.text }
  }
  if (
    (type === 'image' || type === 'file')
    && typeof block.attachment === 'object' && block.attachment !== null
    && typeof (block.attachment as Record<string, unknown>).attachmentId === 'string'
  ) {
    // Session-log content is validated into core ContentBlocks by the
    // Conversation node assembly; the `attachmentId` guard only keeps
    // wire-shaped 'other' blocks with an unrelated `attachment` member out.
    return {
      type,
      content: stringifySourceValue(value),
      ...(type === 'image'
        ? { attachment: block.attachment as ImageAttachmentRef }
        : { file: block.attachment as FileAttachmentRef }),
    }
  }
  return { type, content: stringifySourceValue(value) }
}

export function assistantSourceBlock(block: AssistantBlock): TrajectorySourceBlock {
  switch (block.kind) {
    case 'text': return { type: 'text', content: block.text }
    case 'reasoning': return { type: 'thinking', content: block.text }
    case 'tool-call': return {
      type: 'tool-call',
      content: block.argsRaw,
      callId: block.callId,
      toolName: block.name,
    }
    case 'image': return sourceBlock({ type: 'image', attachment: block.attachment })
    case 'other': return sourceBlock(block.block)
  }
}

export function previewContent(
  content: readonly { type: string; text?: string }[],
): string | undefined {
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string') return block.text
  }
  return undefined
}

export function previewContentProperty(
  content: readonly { type: string; text?: string }[],
): Pick<TrajectoryCellProps, 'previewMarkdown'> {
  const previewMarkdown = previewContent(content)
  return previewMarkdown === undefined ? {} : { previewMarkdown }
}

export function detailContent(content: readonly { type: string; text?: string }[]): string {
  return content
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text ?? '')
    .join('\n')
}

export function detailReasoning(content: readonly { type: string; text?: string }[]): string {
  return content
    .filter(block => block.type === 'reasoning' && typeof block.text === 'string')
    .map(block => block.text ?? '')
    .join('\n')
}

export function summarizeCall(
  name: string,
  argsRaw: string,
): Pick<TrajectoryCellProps, 'text' | 'previewMarkdown' | 'toolName'> {
  return {
    toolName: name,
    text: name,
    ...(argsRaw === '' ? {} : { previewMarkdown: argsRaw }),
  }
}

export function summarizeResult(
  node: ToolResultNode,
  t: TrajectoryTranslate,
): Pick<TrajectoryCellProps, 'result' | 'resultPreviewMarkdown'> {
  if (node.isError) {
    return { result: node.error?.code ?? 'error' }
  }
  for (const block of node.content) {
    if (block.type === 'text' && typeof block.text === 'string' && block.text !== '') {
      return { result: '', resultPreviewMarkdown: block.text }
    }
  }
  const images = imageBlockCount(node.content)
  if (images > 0) return { result: t('layout.imageCount', { count: images }) }
  return { result: t('record.noOutput') }
}

export function resultAsText(
  result: Pick<TrajectoryCellProps, 'result' | 'resultPreviewMarkdown'> | undefined,
): Pick<TrajectoryCellProps, 'text' | 'previewMarkdown'> {
  return {
    text: result?.result ?? '',
    ...(result?.resultPreviewMarkdown === undefined
      ? {}
      : { previewMarkdown: result.resultPreviewMarkdown }),
  }
}

export function detailResult(node: ToolResultNode, t: TrajectoryTranslate): string {
  if (node.isError) {
    return node.error === undefined
      ? 'error'
      : `${node.error.name}: ${node.error.code}`
  }
  const text = node.content
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.type === 'text' ? block.text : '')
    .join('\n')
  if (text !== '') return text
  const images = imageBlockCount(node.content)
  if (images > 0) return t('layout.imageCount', { count: images })
  if (
    node.content.length === 0
    || node.content.every(block =>
      block.type === 'text' && (typeof block.text !== 'string' || block.text === ''))
  ) return t('record.noOutput')
  return JSON.stringify(node.content, null, 2)
}

export function summarizeAssistantActivity(
  blocks: readonly AssistantBlock[],
  t: TrajectoryTranslate,
): string {
  const tools = new Map<string, number>()
  for (const block of blocks) {
    if (block.kind !== 'tool-call') continue
    tools.set(block.name, (tools.get(block.name) ?? 0) + 1)
  }
  if (tools.size > 0) {
    return t('layout.toolCallOnly')
  }
  const images = blocks.filter(block => block.kind === 'image').length
  if (images > 0) return t('layout.imageCount', { count: images })
  return ''
}

export function promptChangeLabel(change: RequestPromptChange, t: TrajectoryTranslate): string {
  if (change.kind === 'initial') return t('layout.initialSystemPrompt')
  if (change.kind === 'system') return t('layout.systemPromptUpdated')
  if (change.kind === 'tools') return t('layout.toolsUpdated')
  return t('layout.systemPromptAndToolsUpdated')
}
