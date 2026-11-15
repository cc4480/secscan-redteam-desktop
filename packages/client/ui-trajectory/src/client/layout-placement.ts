/**
 * Where a turn-less node lands: the entry sort key and the turn/step a user,
 * steering or context node is enclosed in.
 */
import type {
  AssistantMessageNode, ConversationLocation,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TrajectorySnapshot } from './trajectory-contract.ts'
import type { OrderedLayoutEntry } from './layout-types.ts'

export function layoutEntryOrder(entry: OrderedLayoutEntry): number {
  return entry.kind === 'system' && entry.change.kind === 'initial'
    ? Number.NEGATIVE_INFINITY
    : entry.seq
}

/**
 * Turn that encloses a user/message: next assistant turn, else the
 * in-flight partial, else the turn after the last finalized assistant (or 1).
 */
export function enclosingUserTurn(
  followingAssistant: AssistantMessageNode | undefined,
  partial: TrajectorySnapshot['partial'],
  lastAssistantTurn: number | null,
): number {
  if (followingAssistant !== undefined) return followingAssistant.turn
  if (partial !== null) return partial.turn
  if (lastAssistantTurn !== null) return lastAssistantTurn + 1
  return 1
}

export function steeringPlacement(
  followingAssistant: AssistantMessageNode | undefined,
  partial: TrajectorySnapshot['partial'],
  lastAssistantTurn: number | null,
  location: ConversationLocation | undefined,
): { turn: number; step?: number } {
  if (location?.kind === 'step') {
    return { turn: location.turn.turn, step: location.step.step }
  }
  const locatedTurn = location?.kind === 'turn' ? location.turn.turn : undefined
  if (followingAssistant !== undefined
    && (locatedTurn === undefined || followingAssistant.turn === locatedTurn)) {
    return {
      turn: followingAssistant.turn,
      ...(followingAssistant.step > 0 ? { step: followingAssistant.step } : {}),
    }
  }
  if (partial !== null && (locatedTurn === undefined || partial.turn === locatedTurn)) {
    return { turn: partial.turn, ...(partial.step > 0 ? { step: partial.step } : {}) }
  }
  if (locatedTurn !== undefined) return { turn: locatedTurn }
  return { turn: lastAssistantTurn ?? 1 }
}

export function enclosingPromptTurn(
  nodes: TrajectorySnapshot['eventNodes'],
  seq: number,
  partial: TrajectorySnapshot['partial'],
): number {
  const next = nodes.find(node =>
    node.seq > seq && node.kind === 'assistant' && node.step > 0)
  if (next?.kind === 'assistant') return next.turn
  return partial?.turn ?? 1
}

/** Earliest raw turn represented by the selected trajectory branch. */
export function firstVisibleTurn(
  nodes: TrajectorySnapshot['eventNodes'],
  partial: TrajectorySnapshot['partial'],
): number {
  const turns = nodes.flatMap(node =>
    node.kind === 'assistant' && node.turn > 0
      ? [node.turn]
      : [],
  )
  if (partial !== null && partial.turn > 0) turns.push(partial.turn)
  return turns.length === 0 ? 1 : Math.min(...turns)
}
