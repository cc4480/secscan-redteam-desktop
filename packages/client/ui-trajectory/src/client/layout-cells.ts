/**
 * Cell expansion: one assistant record into its Message and Tool cells, a
 * run_code parent into its sub-dispatch cells, and the input cell detail.
 */
import type { TrajectoryTranslate } from './locales.ts'
import type { TrajectoryCellProps } from './trajectory-record.ts'
import type {
  AssistantMessageNode, ToolCallBlock, ToolResultNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InputNode, LaidCell, UsageLike } from './layout-types.ts'
import {
  assistantSourceBlock, detailContent, detailResult, fileBlockCount,
  imageBlockCount, previewContent, resultAsText, sourceBlock,
  summarizeAssistantActivity, summarizeCall, summarizeResult,
} from './layout-content.ts'
import { attachUsage, durationSeconds, finiteTime } from './layout-time.ts'

export function inputCellDetail(node: InputNode, t: TrajectoryTranslate): Pick<
  TrajectoryCellProps,
  | 'text'
  | 'previewMarkdown'
  | 'sourceSeq'
  | 'messageSource'
  | 'inputDetail'
  | 'sourceBlocks'
  | 'timeSeconds'
  | 'startedAt'
> {
  const preview = previewContent(node.content)
  const previewMarkdown = preview === '' ? undefined : preview
  const images = imageBlockCount(node.content)
  const files = fileBlockCount(node.content)
  const attachmentSummary = [
    images > 0
      ? t('layout.imageCount', { count: images })
      : undefined,
    files > 0 ? t('layout.fileAttachments', { count: files }) : undefined,
  ].filter((value): value is string => value !== undefined).join(' · ')
  return {
    text: attachmentSummary,
    ...(previewMarkdown === undefined ? {} : { previewMarkdown }),
    sourceSeq: node.seq,
    messageSource: node.source,
    inputDetail: detailContent(node.content),
    sourceBlocks: node.content.map(block => sourceBlock(block)),
    timeSeconds: 0,
    startedAt: finiteTime(node.time),
  }
}

/** Sub-dispatch cells for one run_code parent, in start order (running = null duration). */
export function expandSubCalls(
  subs: readonly ToolCallBlock[] | undefined,
  startIndex: number,
  t: TrajectoryTranslate,
): LaidCell[] {
  if (subs === undefined || subs.length === 0) return []
  const out: LaidCell[] = []
  let index = startIndex
  for (const sub of subs) {
    if (!('kind' in sub) && sub.phase === 'preparing') continue
    const settled = 'kind' in sub
    const resultPreview = settled ? summarizeResult(sub, t) : undefined
    const laid: LaidCell = {
      absTime: settled ? finiteTime(sub.callTime ?? sub.time) : finiteTime(sub.time),
      toolName: settled ? sub.call?.name ?? sub.callId : sub.name,
      callId: sub.callId,
      cell: {
        index: ++index,
        kind: 'subtool',
        callId: sub.callId,
        ...(settled
          ? (sub.call !== null
            ? summarizeCall(sub.call.name, sub.call.argsRaw)
            : resultAsText(resultPreview))
          : summarizeCall(sub.name, sub.argsRaw)),
        ...(settled
          ? (sub.call !== null ? { inputDetail: sub.call.argsRaw } : {})
          : { inputDetail: sub.argsRaw }),
        ...(settled
          ? {
            outputDetail: detailResult(sub, t),
            outputBlocks: sub.content.map(block => sourceBlock(block)),
            ...resultPreview,
            isError: sub.isError,
          }
          : {}),
        // The code-dispatch start/settle pair carries per-sub-call wall time;
        // a running (unsettled) or pre-pair log entry shows the em dash.
        timeSeconds: settled ? durationSeconds(sub.time, sub.callTime) : null,
        startedAt: settled
          ? finiteTime(sub.callTime)
          : finiteTime(sub.time),
      },
    }
    out.push(laid)
    for (const child of expandSubCalls(sub.subCalls, index, t)) {
      out.push(child)
      index = child.cell.index
    }
  }
  return out
}

/** Interleave each tool cell's nested child calls right after it, reindexing followers. */
export function withSubCalls(laidList: LaidCell[], t: TrajectoryTranslate): LaidCell[] {
  if (!laidList.some(laid => laid.subCalls !== undefined && laid.subCalls.length > 0)) return laidList
  const out: LaidCell[] = []
  let index = laidList[0] !== undefined ? laidList[0].cell.index - 1 : 0
  for (const laid of laidList) {
    out.push({ ...laid, cell: { ...laid.cell, index: ++index } })
    for (const sub of expandSubCalls(laid.subCalls, index, t)) {
      out.push(sub)
      index = sub.cell.index
    }
  }
  return out
}

export function expandAssistant(
  node: AssistantMessageNode,
  startIndex: number,
  prevAbsTime: number | null,
  results: Map<string, ToolResultNode>,
  callStarts: ReadonlyMap<string, number>,
  calls: ReadonlyMap<string, ToolCallBlock>,
  t: TrajectoryTranslate,
  opts?: { streaming?: boolean },
): LaidCell[] {
  if (opts?.streaming === true && node.blocks.length === 0) return []
  const out: LaidCell[] = []
  let index = startIndex - 1
  const usage = node.usage as UsageLike | undefined
  const streaming = opts?.streaming === true
  const recordedStart = finiteTime(node.timing?.stepStartTime)
  const messageDuration = streaming
    ? null
    : durationSeconds(node.time, recordedStart ?? prevAbsTime)
  const nodeAbs = streaming ? null : finiteTime(node.time)
  const messageText = node.blocks
    .filter(block => block.kind === 'text' && (!streaming || block.text !== ''))
    .map(block => block.kind === 'text' ? block.text : '')
    .join('\n\n')
  const thinkingText = node.blocks
    .filter(block => block.kind === 'reasoning' && (!streaming || block.text !== ''))
    .map(block => block.kind === 'reasoning' ? block.text : '')
    .join('\n\n')
  const message: TrajectoryCellProps = {
    index: ++index,
    recordId: `assistant\u0000${node.turn}\u0000${node.step}`,
    kind: 'message',
    sourceSeq: node.seq,
    text: messageText !== '' || thinkingText !== ''
      ? ''
      : summarizeAssistantActivity(node.blocks, t),
    ...(messageText !== ''
      ? { previewMarkdown: messageText }
      : thinkingText !== ''
        ? { previewMarkdown: thinkingText }
        : {}),
    ...(messageText !== '' ? { outputDetail: messageText } : {}),
    ...(thinkingText !== '' ? { thinkingDetail: thinkingText } : {}),
    sourceBlocks: node.blocks.map(block => assistantSourceBlock(block)),
    timeSeconds: messageDuration,
    startedAt: recordedStart,
  }
  attachUsage(message, usage)
  message.assistantMetrics = {
    timingRecorded: node.timing !== undefined,
    stepStartTime: node.timing?.stepStartTime ?? null,
    firstTokenTime: node.timing?.firstTokenTime ?? null,
    completedTime: streaming ? null : finiteTime(node.time),
    usageProvided: usage !== undefined,
    outputTokens: Number.isFinite(usage?.outputTokens) ? usage?.outputTokens ?? null : null,
  }
  out.push({ absTime: nodeAbs, cell: message })

  for (const block of node.blocks) {
    // Text and reasoning belong to the one Assistant record emitted above.
    if (block.kind !== 'tool-call') continue
    const result = results.get(block.callId)
    const toolDuration = streaming || result === undefined
      ? null
      : durationSeconds(result.time, result.callTime)
    const callAbs = finiteTime(callStarts.get(block.callId))
    const call = calls.get(block.callId)
    const resultPreview = result === undefined ? undefined : summarizeResult(result, t)
    out.push({
      absTime: callAbs,
      toolName: block.name,
      callId: block.callId,
      ...(call === undefined ? {} : { subCalls: call.subCalls }),
      cell: {
        index: ++index, kind: 'tool',
        ...summarizeCall(block.name, block.argsRaw),
        inputDetail: block.argsRaw,
        callId: block.callId,
        ...(result !== undefined
          ? {
            outputDetail: detailResult(result, t),
            outputBlocks: result.content.map(block => sourceBlock(block)),
            ...resultPreview,
            isError: result.isError,
          }
          : {}),
        timeSeconds: toolDuration,
        startedAt: callAbs,
      },
    })
  }
  return out
}
