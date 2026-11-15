/**
 * The fold itself: a snapshot into turn → group → cell models.
 */
import type { TrajectoryTranslate } from './locales.ts'
import type {
  AssistantMessageNode, ToolCallBlock,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TrajectoryCellProps } from './trajectory-record.ts'
import type {
  AssistantRequestView, CompactionRequestView, LaidCell, OrderedLayoutEntry,
  TrajectoryLayoutInput, TrajectoryTurnModel, TurnBucket, UsageLike,
} from './layout-types.ts'
import { COMPACTION_INTERRUPTED_ERROR } from './copy-codes.ts'
import {
  collectCallIds, indexAssistantCallIds, indexFollowingAssistants, indexResults,
} from './layout-indexes.ts'
import { attachToolSchema, attachUsage, durationSeconds, finiteTime } from './layout-time.ts'
import {
  enclosingPromptTurn, enclosingUserTurn, firstVisibleTurn, layoutEntryOrder,
  steeringPlacement,
} from './layout-placement.ts'
import {
  detailContent, detailReasoning, detailResult, previewContentProperty,
  promptChangeLabel, resultAsText, sourceBlock, summarizeCall,
  summarizeResult,
} from './layout-content.ts'
import { expandAssistant, expandSubCalls, inputCellDetail, withSubCalls } from './layout-cells.ts'
import { firstCellIndex, toTurnModel } from './layout-turns.ts'

/**
 * Fold a snapshot into turn → Message/Step groups with expanded cells.
 * @param input - nodes plus in-flight partial/runningCalls.
 * @param t - Trajectory locale translator.
 * @returns turns ordered by first appearance.
 */
export function deriveTrajectoryLayout(
  input: TrajectoryLayoutInput,
  t: TrajectoryTranslate,
): readonly TrajectoryTurnModel[] {
  const {
    nodes, eventLocations, partial, runningCalls, requests = [], callSchemas,
  } = input
  const resultByCall = indexResults(nodes)
  const callById = new Map<string, ToolCallBlock>(resultByCall)
  for (const call of runningCalls) callById.set(call.callId, call)
  const emittedCallIds = indexAssistantCallIds(nodes)
  const followingAssistants = indexFollowingAssistants(nodes)
  const callStartById = new Map<string, number>()
  for (const result of resultByCall.values()) {
    const startedAt = finiteTime(result.callTime)
    if (startedAt !== null) callStartById.set(result.callId, startedAt)
  }
  for (const call of runningCalls) {
    if (call.phase === 'preparing') continue
    const startedAt = finiteTime(call.time)
    if (startedAt !== null) callStartById.set(call.callId, startedAt)
  }
  const turns = new Map<number, TurnBucket>()
  const standaloneCompactions: TurnBucket[] = []
  let index = 0
  let prevAbsTime: number | null = null
  let lastAssistantTurn: number | null = null

  const bucket = (turn: number) => {
    let entry = turns.get(turn)
    if (entry === undefined) {
      entry = { groups: [] }
      turns.set(turn, entry)
    }
    return entry
  }

  const pushMessage = (turn: number, laid: LaidCell) => {
    const groups = bucket(turn).groups
    const last = groups.at(-1)
    if (last?.title === t('group.message')) {
      last.laid.push(laid)
      return
    }
    groups.push({ title: t('group.message'), laid: [laid] })
  }
  const pushStep = (turn: number, step: number, laid: readonly LaidCell[]) => {
    if (laid.length === 0) return
    const groups = bucket(turn).groups
    const title = t('group.step', { step })
    const existing = groups.find(group => group.title === title)
    if (existing !== undefined) {
      existing.laid.push(...laid)
      return
    }
    groups.push({ title, laid: [...laid] })
  }
  const pushStepInput = (turn: number, step: number, laid: readonly LaidCell[]) => {
    if (laid.length === 0) return
    const groups = bucket(turn).groups
    const title = t('group.step', { step })
    const existing = groups.find(group => group.title === title)
    if (existing === undefined) {
      groups.push({ title, laid: [...laid] })
      return
    }
    const request = existing.laid.findIndex(entry => entry.cell.requestOnly === true)
    if (request === -1) existing.laid.push(...laid)
    else existing.laid.splice(request, 0, ...laid)
  }

  const representedRequests = new Set<string>()
  for (const node of nodes) {
    if (node.kind === 'assistant' && node.step > 0) {
      representedRequests.add(`${node.turn}\u0000${node.step}`)
    }
  }
  if (partial !== null && partial.step > 0) {
    representedRequests.add(`${partial.turn}\u0000${partial.step}`)
  }
  for (const call of runningCalls) {
    if (call.step > 0) representedRequests.add(`${call.turn}\u0000${call.step}`)
  }

  const entries: OrderedLayoutEntry[] = [
    ...(input.systemPrompts ?? []).map(prompt => ({
      kind: 'system' as const, seq: prompt.seq, systemPrompt: prompt.text,
      change: { seq: prompt.seq, time: prompt.time, kind: prompt.update ? 'system' as const : 'initial' as const },
    })),
    ...nodes.map((node, nodeIndex) => ({
      kind: 'node' as const,
      seq: node.seq,
      node,
      nodeIndex,
    })),
    ...requests
      .filter((request): request is CompactionRequestView =>
        request.purpose === 'compaction')
      .map(request => ({
        kind: 'compaction' as const,
        seq: request.startSeq,
        request,
      })),
    ...requests.flatMap(request => request.purpose !== 'assistant'
      || request.promptChange === undefined
      || request.prompt === undefined
      ? []
      : [{
        kind: 'system' as const,
        seq: request.promptChange.seq,
        request,
        change: request.promptChange,
      }]),
    ...requests
      .filter((request): request is AssistantRequestView =>
        request.purpose === 'assistant')
      .filter(request =>
        !representedRequests.has(`${request.turn}\u0000${request.step}`),
      )
      .map(request => ({
        kind: 'request' as const,
        seq: request.startSeq,
        request,
      })),
  ].sort((left, right) => layoutEntryOrder(left) - layoutEntryOrder(right))

  for (const entry of entries) {
    if (entry.kind === 'request') {
      const { request } = entry
      pushStep(request.turn, request.step, [{
        absTime: finiteTime(request.startedAt),
        cell: {
          index: ++index,
          kind: 'message',
          text: '',
          sourceSeq: request.startSeq,
          requestOnly: true,
          timeSeconds: request.completedAt === null
            ? null
            : durationSeconds(request.completedAt, request.startedAt),
          startedAt: finiteTime(request.startedAt),
          ...(request.status === 'error' ? { isError: true } : {}),
        },
      }])
      prevAbsTime = finiteTime(request.completedAt)
        ?? finiteTime(request.startedAt)
        ?? prevAbsTime
      continue
    }
    if (entry.kind === 'system') {
      const { change, request } = entry
      const turn = change.kind === 'initial'
        ? firstVisibleTurn(nodes, partial)
        : enclosingPromptTurn(nodes, change.seq, partial)
      pushMessage(turn, {
        absTime: finiteTime(change.time),
        cell: {
          index: ++index,
          kind: 'system',
          text: promptChangeLabel(change, t),
          sourceSeq: change.seq,
          ...(request?.prompt === undefined ? {} : { promptDetail: request.prompt }),
          ...(entry.systemPrompt === undefined ? {} : { systemPromptDetail: entry.systemPrompt }),
          ...(change.previous === undefined
            ? {}
            : { previousPromptDetail: change.previous }),
          timeSeconds: 0,
          startedAt: finiteTime(change.time),
        },
      })
      prevAbsTime = finiteTime(change.time) ?? prevAbsTime
      continue
    }
    if (entry.kind === 'compaction') {
      const request = entry.request
      const rawOutput = request.rawOutput ?? request.summary
      const thinkingDetail = rawOutput === undefined
        ? ''
        : detailReasoning(rawOutput)
      const cell: TrajectoryCellProps = {
        index: ++index,
        kind: 'compacted',
        text: request.status === 'running'
          ? t('layout.compacting')
          : request.status === 'error'
            ? request.error === COMPACTION_INTERRUPTED_ERROR
              ? t('layout.compactionInterrupted')
              : request.error ?? t('layout.compactionFailed')
            : request.summary === undefined
              ? t('layout.compacted')
              : '',
        ...(request.status === 'complete' && request.summary !== undefined
          ? previewContentProperty(request.summary)
          : {}),
        sourceSeq: request.startSeq,
        ...(request.summary === undefined
          ? {}
          : {
            outputDetail: detailContent(request.summary),
            outputBlocks: request.summary.map(block => sourceBlock(block)),
          }),
        ...(thinkingDetail === '' ? {} : { thinkingDetail }),
        ...(rawOutput === undefined
          ? {}
          : { sourceBlocks: rawOutput.map(block => sourceBlock(block)) }),
        ...(request.status === 'error' ? { isError: true } : {}),
        timeSeconds: request.completedAt === null
          ? null
          : durationSeconds(request.completedAt, request.startedAt),
        startedAt: finiteTime(request.startedAt),
      }
      attachUsage(cell, request.usage as UsageLike | undefined)
      const compaction: TurnBucket = {
        groups: [{
          title: t('group.compaction', { seq: request.startSeq }),
          laid: [{
            absTime: finiteTime(request.startedAt),
            cell,
          }],
        }],
      }
      if (request.turn === null) standaloneCompactions.push(compaction)
      else bucket(request.turn).groups.push(...compaction.groups)
      prevAbsTime = finiteTime(request.completedAt) ?? finiteTime(request.startedAt) ?? prevAbsTime
      continue
    }
    const { node, nodeIndex: i } = entry
    if (node.kind === 'user') {
      // user/message has no turn on the wire; enclose it in the next assistant
      // (or partial) turn, else open the turn after the last assistant.
      const turn = enclosingUserTurn(followingAssistants[i], partial, lastAssistantTurn)
      pushMessage(turn, {
        absTime: finiteTime(node.time),
        cell: {
          index: ++index,
          kind: 'user',
          ...inputCellDetail(node, t),
          opensTurn: true,
        },
      })
      prevAbsTime = finiteTime(node.time) ?? prevAbsTime
      continue
    }
    if (node.kind === 'steering') {
      const placement = steeringPlacement(
        followingAssistants[i],
        partial,
        lastAssistantTurn,
        eventLocations?.get(node.seq),
      )
      const laid = {
        absTime: finiteTime(node.time),
        cell: {
          index: ++index,
          kind: 'user' as const,
          ...inputCellDetail(node, t),
        },
      }
      if (placement.step === undefined) pushMessage(placement.turn, laid)
      else pushStepInput(placement.turn, placement.step, [laid])
      prevAbsTime = finiteTime(node.time) ?? prevAbsTime
      continue
    }
    if (node.kind === 'assistant') {
      const laidList = withSubCalls(
        expandAssistant(node, index + 1, prevAbsTime, resultByCall, callStartById, callById, t),
        t,
      )
      if (node.step > 0) pushStep(node.turn, node.step, laidList)
      else for (const laid of laidList) pushMessage(node.turn, laid)
      const last = laidList[laidList.length - 1]
      if (last !== undefined) index = last.cell.index
      prevAbsTime = finiteTime(node.time) ?? prevAbsTime
      lastAssistantTurn = node.turn
      continue
    }
    if (node.kind === 'context') {
      const turn = enclosingUserTurn(followingAssistants[i], partial, lastAssistantTurn)
      pushMessage(turn, {
        absTime: finiteTime(node.time),
        cell: {
          index: ++index,
          kind: 'context',
          ...inputCellDetail(node, t),
        },
      })
      prevAbsTime = finiteTime(node.time) ?? prevAbsTime
      continue
    }
    if (node.kind === 'compaction') {
      // Chat owns the human-facing compaction marker. It contributes no
      // duplicate trajectory cell, but still advances the duration cursor.
      prevAbsTime = finiteTime(node.time) ?? prevAbsTime
      continue
    }
    if (node.kind === 'tool-result') {
      if (!emittedCallIds.has(node.callId)) {
        const toolName = node.call?.name
        const resultPreview = summarizeResult(node, t)
        const laidList: LaidCell[] = [{
          absTime: finiteTime(node.callTime ?? node.time),
          ...(toolName !== undefined ? { toolName } : {}),
          callId: node.callId,
          subCalls: node.subCalls,
          cell: {
            index: ++index,
            kind: 'tool',
            sourceSeq: node.seq,
            ...(node.call !== null
              ? summarizeCall(node.call.name, node.call.argsRaw)
              : resultAsText(resultPreview)),
            ...(node.call !== null ? { inputDetail: node.call.argsRaw } : {}),
            outputDetail: detailResult(node, t),
            outputBlocks: node.content.map(block => sourceBlock(block)),
            ...resultPreview,
            callId: node.callId,
            isError: node.isError,
            timeSeconds: durationSeconds(node.time, node.callTime),
            startedAt: finiteTime(node.callTime),
          },
        }]
        for (const laid of expandSubCalls(node.subCalls, index, t)) {
          laidList.push(laid)
          index = laid.cell.index
        }
        pushStep(0, 1, laidList)
      }
      prevAbsTime = finiteTime(node.time) ?? prevAbsTime
    }
  }

  if (partial !== null) {
    const fake: AssistantMessageNode = {
      kind: 'assistant', seq: Number.MAX_SAFE_INTEGER, time: 0,
      turn: partial.turn, step: partial.step, blocks: partial.blocks,
    }
    const laidList = withSubCalls(expandAssistant(
      fake,
      index + 1,
      prevAbsTime,
      resultByCall,
      callStartById,
      callById,
      t,
      { streaming: true },
    ), t)
    if (partial.step > 0) pushStep(partial.turn, partial.step, laidList)
    else for (const laid of laidList) pushMessage(partial.turn, laid)
    const last = laidList[laidList.length - 1]
    if (last !== undefined) index = last.cell.index
  }

  const seenCalls = collectCallIds(turns)
  for (const call of runningCalls) {
    if (call.phase === 'preparing' || seenCalls.has(call.callId)) continue
    const laidList: LaidCell[] = [{
      absTime: null,
      toolName: call.name,
      callId: call.callId,
      subCalls: call.subCalls,
      cell: {
        index: ++index,
        kind: 'tool',
        ...summarizeCall(call.name, call.argsRaw),
        inputDetail: call.argsRaw,
        callId: call.callId,
        timeSeconds: null,
        startedAt: finiteTime(call.time),
      },
    }]
    for (const laid of expandSubCalls(call.subCalls, index, t)) {
      laidList.push(laid)
      index = laid.cell.index
    }
    if (call.step > 0) pushStep(call.turn, call.step, laidList)
    else for (const laid of laidList) pushMessage(call.turn, laid)
  }

  // Orphan turn-0 cells (orphaned tools) fold into Turn 1.
  const prologue = turns.get(0)
  if (prologue !== undefined) {
    turns.delete(0)
    const emptyTurn = (): TurnBucket => ({ groups: [] })
    const first = turns.get(1) ?? emptyTurn()
    first.groups = [...prologue.groups, ...first.groups]
    turns.set(1, first)
  }

  for (const entry of [...turns.values(), ...standaloneCompactions]) {
    for (const group of entry.groups) {
      for (const laid of group.laid) attachToolSchema(laid, callSchemas)
    }
  }

  return [
    ...[...turns.entries()].map(([turn, entry]) => toTurnModel(turn, entry, t)),
    ...standaloneCompactions.map(entry => toTurnModel(null, entry, t)),
  ].sort((left, right) => firstCellIndex(left) - firstCellIndex(right))
}
