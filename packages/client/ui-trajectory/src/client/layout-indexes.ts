/**
 * Single-pass indexes the fold builds over a snapshot: tool results by call id,
 * call ids already emitted by an assistant, and the assistant that follows each
 * node.
 */
import type { TrajectorySnapshot } from './trajectory-contract.ts'
import type {
  AssistantMessageNode, ToolResultNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TurnBucket } from './layout-types.ts'

export function indexFollowingAssistants(
  nodes: TrajectorySnapshot['eventNodes'],
): readonly (AssistantMessageNode | undefined)[] {
  const following = new Array<AssistantMessageNode | undefined>(nodes.length)
  let assistant: AssistantMessageNode | undefined
  for (let index = nodes.length - 1; index >= 0; index--) {
    following[index] = assistant
    const node = nodes[index]
    if (node?.kind === 'assistant') assistant = node
  }
  return following
}

export function indexResults(nodes: TrajectorySnapshot['eventNodes']): Map<string, ToolResultNode> {
  const map = new Map<string, ToolResultNode>()
  for (const node of nodes) {
    if (node.kind === 'tool-result') map.set(node.callId, node)
  }
  return map
}

export function indexAssistantCallIds(nodes: TrajectorySnapshot['eventNodes']): ReadonlySet<string> {
  const ids = new Set<string>()
  for (const node of nodes) {
    if (node.kind !== 'assistant') continue
    for (const block of node.blocks) {
      if (block.kind === 'tool-call') ids.add(block.callId)
    }
  }
  return ids
}

export function collectCallIds(
  turns: Map<number, TurnBucket>,
): Set<string> {
  const ids = new Set<string>()
  for (const entry of turns.values()) {
    for (const group of entry.groups) {
      for (const laid of group.laid) {
        if (laid.callId !== undefined) ids.add(laid.callId)
      }
    }
  }
  return ids
}
