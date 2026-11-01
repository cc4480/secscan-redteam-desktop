import type { Context } from '@deepseek-ai/cordis'
import type {
  AssistantBlock, AssistantMessageNode, ConversationContextReader, ConversationLocation,
  ConversationMatch, ConversationNodeContext, ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-llm-retry/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type {
  AssistantChatData, AssistantSpeaker, AssistantSpeakerRole,
} from '../contract/chat-nodes.ts'
import { CHAT_SYNTHETIC_SEQ_OFFSETS, chatNode } from './common.ts'
import {
  emptyAssistantBlock, isTokenDelta, toAssistantBlock, toAssistantBlocks,
} from './event-projection.ts'

declare module '../contract/chat-nodes.ts' {
  interface ChatNodeDataMap {
    /** Streaming, settled, or interrupted Assistant step. */
    'assistant-step': AssistantChatData
  }
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationStepDataMap {
    /** Streaming, settled, or interrupted Assistant material for this Step. */
    'assistant-step': AssistantChatData
  }
}

interface AssistantState {
  readonly turn: number
  readonly step: number
  readonly blocks: readonly (AssistantBlock | undefined)[]
  readonly visibleBlocks: number
  readonly firstVisibleSeq: number | undefined
  readonly firstVisibleTime: number | undefined
  readonly firstTokenTime: number | undefined
  readonly final: ConversationMatch | undefined
  readonly usage: unknown
  readonly speaker: AssistantSpeaker | undefined
}

function initialState(
  turn: number,
  step: number,
  speaker?: AssistantSpeaker,
): AssistantState {
  return {
    turn,
    step,
    blocks: [],
    visibleBlocks: 0,
    firstVisibleSeq: undefined,
    firstVisibleTime: undefined,
    firstTokenTime: undefined,
    final: undefined,
    usage: undefined,
    speaker,
  }
}

const SPEAKER_ROLES: ReadonlySet<string> = new Set<AssistantSpeakerRole>([
  'lead', 'recon', 'exploiter', 'architect', 'reporter',
])

/**
 * Engagement tool names whose results can carry a speaker stamp. MCP
 * tools surface as `mcp__<server>__<raw name>`, so the fold matches the
 * raw-name suffix and never depends on the server's configured name.
 */
const ENGAGEMENT_TOOL_SUFFIXES: readonly string[] = ['__engagement_status', '__engagement_report']

function isMetaRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Narrow one `tool/result` meta payload to a speaker stamp. The meta is
 * opaque JSON persisted with the session log; only the exact stamped
 * shape — the `redteamSpeaker` record the MCP bridge projected from
 * the runner's execution-side stamp, with a non-empty name and a role
 * in the chip vocabulary — is accepted. Anything else names no speaker.
 *
 * @param meta - The result event's meta payload, when present.
 * @returns The recorded speaker, or undefined when unstamped.
 */
function speakerFromMeta(meta: unknown): AssistantSpeaker | undefined {
  if (!isMetaRecord(meta)) return undefined
  const stamp = meta['redteamSpeaker']
  if (!isMetaRecord(stamp)) return undefined
  const { name, role } = stamp
  if (typeof name !== 'string' || name.length === 0) return undefined
  if (typeof role !== 'string' || !SPEAKER_ROLES.has(role)) return undefined
  return { name, role: role as AssistantSpeakerRole }
}

/** The fields of a predecessor Tool Context's State the fold reads. */
interface PredecessorToolState {
  readonly root: {
    readonly kind: string
    readonly call?: { readonly name: string } | null
    readonly meta?: unknown
  }
}

/**
 * The speaker recorded for one Assistant step: the stamp on the
 * settled result of the tool call the step narrates — the call made in
 * the immediately preceding step of the same turn, read from that Tool
 * Context's recorded result at this step's start. The read happens
 * only for steps after the first: a first step has no in-turn
 * predecessor, so it never records a predecessor dependency and window
 * operations (prepends filling older turns) never invalidate it. A
 * predecessor in another turn or step, one that is not an engagement
 * tool, an unsettled or unstamped result, or a malformed stamp all
 * yield no speaker: a conservative miss renders the model id, never a
 * guess.
 *
 * @param reader - The start hook's strictly-backward Context lookup.
 * @param turn - This step's turn.
 * @param step - This step's index within its turn.
 * @returns The recorded speaker, or undefined when none is proven.
 */
function speakerFromPredecessor(
  reader: ConversationContextReader,
  turn: number,
  step: number,
): AssistantSpeaker | undefined {
  if (step <= 1) return undefined
  const previous = reader.previous<PredecessorToolState>('tool-call')
  if (previous === undefined) return undefined
  const callEvent = previous.matches[0]?.event
  if (callEvent?.type !== 'tool/call') return undefined
  const callData = callEvent.data as { turn?: unknown; step?: unknown }
  if (callData.turn !== turn || callData.step !== step - 1) return undefined
  const root = previous.state.root
  if (root.kind !== 'tool-result') return undefined
  const callName = root.call?.name
  if (callName === undefined) return undefined
  if (!ENGAGEMENT_TOOL_SUFFIXES.some(suffix => callName.endsWith(suffix))) return undefined
  return speakerFromMeta(root.meta)
}

function compactBlocks(blocks: readonly (AssistantBlock | undefined)[]): AssistantBlock[] {
  return blocks.filter((block): block is AssistantBlock => block !== undefined)
}

function blockIsVisible(block: AssistantBlock | undefined): boolean {
  if (block === undefined || block.kind === 'tool-call') return false
  if (block.kind === 'text' || block.kind === 'reasoning') return block.text.trim() !== ''
  return true
}

function countVisibleBlocks(blocks: readonly AssistantBlock[]): number {
  let count = 0
  for (const block of blocks) if (blockIsVisible(block)) count++
  return count
}

function hasVisibleContent(blocks: readonly AssistantBlock[]): boolean {
  return blocks.some(blockIsVisible)
}

function hasInterruptionEvidence(blocks: readonly AssistantBlock[]): boolean {
  return blocks.some((block) => {
    if (block.kind === 'text' || block.kind === 'reasoning') return block.text.trim() !== ''
    return true
  })
}

function resetForRetry(state: AssistantState): AssistantState {
  return {
    ...initialState(state.turn, state.step, state.speaker),
    firstTokenTime: state.firstTokenTime,
  }
}

function updateChunk(
  state: AssistantState,
  chunk: StreamChunk,
  seq: number,
  time: number,
): AssistantState {
  const blocks = [...state.blocks]
  let changedIndex = -1
  let previousVisible = false
  switch (chunk.type) {
    case 'block-start':
      changedIndex = chunk.index
      previousVisible = blockIsVisible(blocks[chunk.index])
      blocks[chunk.index] = emptyAssistantBlock(chunk.blockType)
      break
    case 'text-delta': {
      const previous = blocks[chunk.index]
      changedIndex = chunk.index
      previousVisible = blockIsVisible(previous)
      blocks[chunk.index] = { kind: 'text', text: (previous?.kind === 'text' ? previous.text : '') + chunk.text }
      break
    }
    case 'reasoning-delta': {
      const previous = blocks[chunk.index]
      changedIndex = chunk.index
      previousVisible = blockIsVisible(previous)
      blocks[chunk.index] = { kind: 'reasoning', text: (previous?.kind === 'reasoning' ? previous.text : '') + chunk.text }
      break
    }
    case 'tool-call-delta': {
      const previous = blocks[chunk.index]
      changedIndex = chunk.index
      previousVisible = blockIsVisible(previous)
      const base = previous?.kind === 'tool-call'
        ? previous
        : { kind: 'tool-call' as const, callId: '', name: '', argsRaw: '' }
      blocks[chunk.index] = {
        kind: 'tool-call',
        callId: base.callId || String(chunk.id),
        name: chunk.name ?? base.name,
        argsRaw: base.argsRaw + chunk.argumentsDelta,
      }
      break
    }
    case 'block-end':
      changedIndex = chunk.index
      previousVisible = blockIsVisible(blocks[chunk.index])
      blocks[chunk.index] = toAssistantBlock(chunk.block)
      break
    case 'usage':
      return { ...state, usage: chunk.usage }
    default:
      return state
  }
  const visibleBlocks = state.visibleBlocks
    - Number(previousVisible)
    + Number(blockIsVisible(blocks[changedIndex]))
  const firstToken = isTokenDelta(chunk)
  return {
    ...state,
    blocks,
    visibleBlocks,
    ...visibleBlocks > 0 && state.firstVisibleSeq === undefined
      ? { firstVisibleSeq: seq, firstVisibleTime: time }
      : {},
    ...firstToken && state.firstTokenTime === undefined
      ? { firstTokenTime: time }
      : {},
  }
}

function settleMessage(
  state: AssistantState,
  match: ConversationMatch,
  event: SessionEvent<'assistant/message'>,
): AssistantState {
  const blocks = toAssistantBlocks(event.data.message.content)
  return {
    ...state,
    blocks,
    visibleBlocks: countVisibleBlocks(blocks),
    final: match,
    usage: event.data.usage,
  }
}

function closedBoundary(location: ConversationLocation): { seq: number; time: number } | undefined {
  if (location.kind === 'step' && location.step.status === 'closed' && location.step.end !== undefined) {
    return location.step.end
  }
  if ((location.kind === 'step' || location.kind === 'turn')
    && location.turn.status === 'closed' && location.turn.end !== undefined) {
    return location.turn.end
  }
  return undefined
}

function finalNode(
  state: AssistantState,
  context: ConversationNodeContext<AssistantState>,
): AssistantMessageNode | undefined {
  const final = state.final
  if (final?.event.type === 'assistant/message') {
    const event = final.event
    return {
      kind: 'assistant',
      seq: event.seq,
      messageId: event.data.message.id,
      time: event.time,
      turn: state.turn,
      step: state.step,
      blocks: toAssistantBlocks(event.data.message.content),
      usage: event.data.usage,
      providerMetadata: {
        provider: event.data.message.source.provider,
        model: event.data.message.source.model,
      },
      timing: {
        stepStartTime: context.start?.event.time ?? null,
        firstTokenTime: state.firstTokenTime ?? null,
        completedTime: event.time,
      },
      ...event.data.interrupted === true ? { interrupted: true } : {},
    }
  }
  const location = context.start?.location ?? context.matches.at(-1)?.location
  const boundary = location === undefined ? undefined : closedBoundary(location)
  if (boundary === undefined) return undefined
  const blocks = compactBlocks(state.blocks)
  if (!hasInterruptionEvidence(blocks)) return undefined
  return {
    kind: 'assistant',
    seq: boundary.seq + CHAT_SYNTHETIC_SEQ_OFFSETS.interruptedAssistant,
    time: boundary.time,
    turn: state.turn,
    step: state.step,
    blocks,
    interrupted: true,
  }
}

function fallbackState(context: ConversationNodeContext<AssistantState>): AssistantState | undefined {
  let state: AssistantState | undefined
  for (const match of context.matches) {
    if (match.event.type === 'assistant/live-chunk') {
      state ??= initialState(match.event.data.turn, match.event.data.step)
      state = updateChunk(state, match.event.data.chunk, match.event.seq, match.event.time)
      continue
    }
    if (match.event.type === 'assistant/message') {
      state ??= initialState(match.event.data.turn, match.event.data.step)
      state = settleMessage(state, match, match.event)
      continue
    }
    if (match.event.type === 'llm/retry' && state !== undefined) {
      state = resetForRetry(state)
    }
  }
  return state
}

interface AssistantProjection {
  readonly data: AssistantChatData
  readonly anchorSeq: number
  readonly visible: boolean
  readonly settled: AssistantMessageNode | undefined
}

function projectAssistant(context: ConversationNodeContext<AssistantState>): AssistantProjection | undefined {
  const state = context.state ?? fallbackState(context)
  if (state === undefined) return undefined
  const settled = finalNode(state, context)
  const blocks = settled?.blocks ?? compactBlocks(state.blocks)
  const visible = settled === undefined ? state.visibleBlocks > 0 : hasVisibleContent(blocks)
  const status = settled?.interrupted === true
    ? 'interrupted'
    : settled === undefined ? 'running' : 'settled'
  const anchorSeq = (settled?.interrupted === true ? settled.seq : state.firstVisibleSeq ?? settled?.seq)
    ?? context.matches[0]?.event.seq ?? 0
  const time = settled?.time ?? state.firstVisibleTime ?? context.matches[0]?.event.time ?? 0
  return {
    anchorSeq,
    visible,
    settled,
    data: {
      status,
      turn: state.turn,
      step: state.step,
      blocks,
      time,
      ...state.usage === undefined ? {} : { usage: state.usage },
      ...settled === undefined ? {} : { finalNode: settled },
      ...settled?.providerMetadata === undefined ? {} : { model: settled.providerMetadata.model },
      ...state.speaker === undefined ? {} : { speaker: state.speaker },
    },
  }
}

function publishedAssistantData(
  context: ConversationNodeContext<AssistantState>,
): Readonly<AssistantChatData> | undefined {
  const location = context.start?.location ?? context.matches.at(-1)?.location
  return location?.kind === 'step' ? location.step.data.get('assistant-step') : undefined
}

/** Per-step Assistant lifecycle; materialized keys survive cleared stream content as hidden Nodes. */
export const assistantDefinition: ConversationNodeDefinition<AssistantState> = {
  kind: 'assistant-step',
  target: 'chat',
  match: (event) => {
    if (event.type === 'step/start') return { id: `${event.data.turn}:${event.data.step}`, role: 'start' }
    if (event.type === 'assistant/live-chunk'
      || (event.type === 'assistant/message' && event.surfaceOp === 'append')) {
      return { id: `${event.data.turn}:${event.data.step}`, role: 'update' }
    }
    if (event.type === 'llm/retry') {
      return { id: `${event.data.turn}:${event.data.step}`, role: 'update' }
    }
    return null
  },
  start: (_context, match, reader) => {
    if (match.event.type !== 'step/start') throw new Error('assistant-step start requires step/start')
    const { turn, step } = match.event.data
    return initialState(turn, step, speakerFromPredecessor(reader, turn, step))
  },
  update: (context, match) => {
    if (match.event.type === 'assistant/live-chunk') {
      return updateChunk(context.state, match.event.data.chunk, match.event.seq, match.event.time)
    }
    if (match.event.type === 'assistant/message') return settleMessage(context.state, match, match.event)
    if (match.event.type === 'llm/retry') {
      return resetForRetry(context.state)
    }
    return context.state
  },
  publication: (match) => {
    if (match.event.type === 'step/start') return 'none'
    if (match.event.type !== 'assistant/live-chunk') return 'immediate'
    const type = match.event.data.chunk.type
    return type === 'usage' || type === 'finish' ? 'none' : 'animation-frame'
  },
  buildLocationData: (context, scope) => {
    if (scope !== 'step') return null
    const projected = projectAssistant(context)
    if (projected === undefined) return null
    return {
      kind: 'step',
      turn: projected.data.turn,
      step: projected.data.step,
      key: 'assistant-step',
      value: projected.data,
    }
  },
  buildViewNode: (context) => {
    const current = context.current.get('chat')
    const state = context.state ?? fallbackState(context)
    const data = publishedAssistantData(context)
    if (state === undefined || data === undefined) {
      return current == null ? null : { ...current, visibility: 'hidden' }
    }
    const settled = data.finalNode
    const visible = settled === undefined ? state.visibleBlocks > 0 : hasVisibleContent(data.blocks)
    if (settled === undefined && !visible && current == null) return null
    // A successful message retains its live anchor alongside pending Tool calls.
    const anchorSeq = (settled?.interrupted === true ? settled.seq : state.firstVisibleSeq ?? settled?.seq)
      ?? context.matches[0]?.event.seq ?? 0
    return chatNode(context, 'assistant-step', anchorSeq, data, {
      visibility: settled?.interrupted === true || visible ? 'visible' : 'hidden',
    })
  },
}

/**
 * Register the Assistant lifecycle business contribution.
 * @param ctx - owning UI Conversation context.
 */
export function registerAssistantConversationNode(ctx: Context): void {
  ctx.uiConversation.events.register(assistantDefinition)
}
