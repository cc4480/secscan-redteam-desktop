/**
 * Timing and metering for a laid cell: epoch-ms usability, own durations, group
 * wall spans, provider usage, and the tool schema detail.
 */
import type { TrajectoryTranslate } from './locales.ts'
import type { TrajectoryCellProps } from './trajectory-record.ts'
import type { RequestInspectionSnapshot } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { LaidCell, UsageLike } from './layout-types.ts'
import { formatElapsedSeconds } from './trajectory-record.ts'

/** Epoch-ms usable as an absolute time, else null. */
export function finiteTime(time: number | null | undefined): number | null {
  return typeof time === 'number' && Number.isFinite(time) ? time : null
}

/** Own-duration seconds from two epoch-ms stamps; null when either is unusable. */
export function durationSeconds(later: number, earlier: number | null): number | null {
  if (earlier === null || !Number.isFinite(later) || !Number.isFinite(earlier)) return null
  return Math.max(0, (later - earlier) / 1000)
}

function formatGroupDuration(
  seconds: number,
  t: TrajectoryTranslate,
): string | undefined {
  if (!Number.isFinite(seconds)) return undefined
  return formatElapsedSeconds(seconds, t)
}

/** Wall-span duration + tool histogram, e.g. `1.5 s bash×6`. */
export function groupDescription(
  laid: readonly LaidCell[],
  t: TrajectoryTranslate,
): string | undefined {
  const parts: string[] = []
  // Tool rows contribute start (absTime) and end (start + own duration) so a
  // single Tool cell still spans call→result for the group wall clock.
  const times: number[] = []
  for (const l of laid) {
    if (l.absTime === null || !Number.isFinite(l.absTime)) continue
    times.push(l.absTime)
    if (l.cell.kind === 'tool' && l.cell.timeSeconds !== null && Number.isFinite(l.cell.timeSeconds)) {
      times.push(l.absTime + l.cell.timeSeconds * 1000)
    }
  }
  if (times.length >= 2) {
    const span = formatGroupDuration((Math.max(...times) - Math.min(...times)) / 1000, t)
    if (span !== undefined) parts.push(span)
  } else if (times.length === 1) {
    const own = laid.find(l => l.absTime === times[0])?.cell.timeSeconds
    const span = own !== null && own !== undefined ? formatGroupDuration(own, t) : undefined
    if (span !== undefined) parts.push(span)
  }
  const tools = new Map<string, number>()
  for (const l of laid) {
    if (l.toolName === undefined || l.cell.kind !== 'tool') continue
    tools.set(l.toolName, (tools.get(l.toolName) ?? 0) + 1)
  }
  for (const [name, count] of tools) {
    parts.push(count > 1 ? `${name}×${count}` : name)
  }
  return parts.length === 0 ? undefined : parts.join(' ')
}

/** Copy provider usage onto a Message cell when present. */
export function attachUsage(cell: TrajectoryCellProps, usage: UsageLike | undefined): void {
  if (usage === undefined) return
  if (usage.inputTokens !== undefined) cell.input = usage.inputTokens
  if (usage.cacheReadTokens !== undefined) cell.cacheRead = usage.cacheReadTokens
  if (usage.cacheWriteTokens !== undefined) cell.cacheWrite = usage.cacheWriteTokens
  if (usage.outputTokens !== undefined) cell.output = usage.outputTokens
  if (usage.reasoningTokens !== undefined) cell.think = usage.reasoningTokens
}

export function attachToolSchema(
  laid: LaidCell,
  callSchemas: RequestInspectionSnapshot['callSchemas'] | undefined,
): void {
  if (laid.callId === undefined || callSchemas === undefined) return
  const schema = callSchemas.get(laid.callId)
  if (schema === undefined) return
  laid.cell.schemaDetail = JSON.stringify(schema, null, 2)
}
