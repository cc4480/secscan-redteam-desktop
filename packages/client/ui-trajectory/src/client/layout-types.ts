/**
 * Types the trajectory fold passes between its stages: the public turn/group
 * model, the snapshot slice it folds, and the internal laid-cell and ordered
 * entry shapes.
 */
import type { TrajectoryCellProps } from './trajectory-record.ts'
import type { TrajectorySnapshot } from './trajectory-contract.ts'
import type {
  ConversationLocation, RequestInspectionSnapshot, RequestPromptChange, RequestView,
  ToolCallBlock,
} from '@deepseek-ai/dsh-client-ui-conversation/client'

/** One Message or Step group inside a turn. */
export interface TrajectoryGroupModel {
  title: string
  description?: string
  cells: readonly TrajectoryCellProps[]
}

/** One sticky turn, or a standalone compaction section between turns. */
export interface TrajectoryTurnModel {
  turn: number | null
  groups: readonly TrajectoryGroupModel[]
}

/** Snapshot slice the trajectory view folds. */
export interface TrajectoryLayoutInput {
  systemPrompts?: TrajectorySnapshot['systemPrompts']
  nodes: TrajectorySnapshot['eventNodes']
  eventLocations?: ReadonlyMap<number, ConversationLocation>
  partial: TrajectorySnapshot['partial']
  runningCalls: TrajectorySnapshot['runningCalls']
  requests?: readonly RequestView[]
  callSchemas?: RequestInspectionSnapshot['callSchemas']
}

export interface UsageLike {
  inputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  outputTokens?: number
  reasoningTokens?: number
}

/** Cell plus absolute ms for group wall-span descriptions. */
export interface LaidCell {
  cell: TrajectoryCellProps
  absTime: number | null
  toolName?: string
  callId?: string
  subCalls?: readonly ToolCallBlock[]
}

interface LaidGroup {
  title: string
  laid: LaidCell[]
}

export interface TurnBucket {
  groups: LaidGroup[]
}

export type AssistantRequestView = Extract<RequestView, { purpose: 'assistant' }>

export type CompactionRequestView = Extract<RequestView, { purpose: 'compaction' }>

export type InputNode = Extract<
  TrajectorySnapshot['eventNodes'][number],
  { kind: 'user' | 'steering' | 'context' }
>

export type OrderedLayoutEntry =
  | {
    kind: 'node'
    seq: number
    node: TrajectorySnapshot['eventNodes'][number]
    nodeIndex: number
  }
  | {
    kind: 'compaction'
    seq: number
    request: CompactionRequestView
  }
  | {
    kind: 'system'
    seq: number
    request?: AssistantRequestView
    systemPrompt?: string
    change: RequestPromptChange
  }
  | {
    kind: 'request'
    seq: number
    request: AssistantRequestView
  }
