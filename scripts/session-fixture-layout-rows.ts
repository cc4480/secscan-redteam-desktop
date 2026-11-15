/** Session-fixture row decoding: packed-row expansion and envelope stripping. */

import {
  decodeSeqRanges,
  SessionLogOffset,
  type SessionEvent,
} from '@deepseek-ai/dsh-session'
import type { SessionLogOffset as SessionLogOffsetType } from '@deepseek-ai/dsh-session'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import { SessionFormatEventCollector, type SessionFormatArtifactDecoder, type SessionFormatCodec } from '@deepseek-ai/dsh-session-format'
import { releasedV0SessionFormatCodec, releasedV1SessionFormatCodec } from '@deepseek-ai/dsh-session-format-v0-to-v1'
import { releasedV2SessionFormatCodec } from '@deepseek-ai/dsh-session-format-v1-to-v2'
import { releasedV3SessionFormatCodec } from '@deepseek-ai/dsh-session-format-v2-to-v3'

const historicalCodecs: readonly SessionFormatCodec[] = [
  releasedV0SessionFormatCodec, releasedV1SessionFormatCodec, releasedV2SessionFormatCodec,
  releasedV3SessionFormatCodec,
]

/**
 * Whether a parsed JSONL record is a session header.
 * @param value - Parsed JSON value from the document's first non-blank line.
 * @returns True for a session header record.
 */
export function isSessionHeader(value: unknown): boolean {
  return value !== null && typeof value === 'object' && (value as { type?: unknown }).type === 'session'
}

function validationHeader(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
  const header = { ...value as Record<string, unknown> }
  if (header.version === 0 && !Object.hasOwn(header, 'delegationDepth')) header.delegationDepth = 0
  if (typeof header.cwd === 'string' && /^\{\{cwd\}\}(?:\/|$)/.test(header.cwd)) {
    header.cwd = header.cwd.replace('{{cwd}}', '/dsh-snapshot-cwd')
  }
  return header
}

/**
 * Render a canonical JSONL document from its header line and events.
 * @param headerLine - The preserved session header line.
 * @param events - Events to emit one per row without sequence/time envelopes.
 * @returns Canonical JSONL text.
 */
export function renderFixture(headerLine: string, events: readonly SessionEvent[]): string {
  return [
    headerLine,
    ...events.map((event) => {
      const record: Record<string, unknown> = { ...event }
      delete record.seq
      delete record.time
      return JSON.stringify(record)
    }),
    '',
  ].join('\n')
}

/**
 * Drop the storage sequence/time envelopes from events.
 * @param events - Source events.
 * @returns Events without `seq` and `time`.
 */
export function withoutEnvelope(events: readonly SessionEvent[]): Array<Omit<SessionEvent, 'seq' | 'time'>> {
  return events.map((event) => {
    const { seq: _seq, time: _time, ...projected } = event
    return projected
  })
}

function projectedRowCardinality(record: Readonly<Record<string, unknown>>): number {
  const data = record.data
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return 1
  const key = record.type === 'tool-call-chunks' ? 'args' : 'texts'
  const values = (data as Record<string, unknown>)[key]
  return Array.isArray(values) && values.length > 0 ? values.length : 1
}

function parseFixtureObjectLine(line: string, lineNumber: number): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch (error) {
    throw new Error(`session snapshot line ${lineNumber} contains invalid JSON`, { cause: error })
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`session snapshot line ${lineNumber} must be a JSON object`)
  }
  return value as Record<string, unknown>
}

/**
 * Decode a fixture document's body rows into events.
 * @param content - JSONL source text.
 * @param headerValue - Parsed session header record.
 * @returns Events in source order, with packed rows expanded.
 */
export function parseFixtureRows(content: string, headerValue: unknown): SessionEvent[] {
  const rows: Record<string, unknown>[] = []
  const rowLines: number[] = []
  const eventLines: number[] = []
  let nextSeq: SessionLogOffsetType = SessionLogOffset(0)
  let headerSkipped = false
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (line.trim().length === 0) continue
    if (!headerSkipped) {
      headerSkipped = true
      continue
    }
    const record = parseFixtureObjectLine(line, index + 1)
    const packed = record.type === 'text-chunks'
      || record.type === 'reasoning-chunks'
      || record.type === 'tool-call-chunks'
    const seqKey = packed ? 'seq0' : 'seq'
    const timeKey = packed ? 'time0' : 'time'
    if (!Object.hasOwn(record, seqKey)) record[seqKey] = nextSeq
    if (!Object.hasOwn(record, timeKey)) record[timeKey] = 0
    rows.push(record)
    rowLines.push(index + 1)
    const cardinality = projectedRowCardinality(record)
    for (let offset = 0; offset < cardinality; offset += 1) eventLines.push(index + 1)
    nextSeq = SessionLogOffset(nextSeq + cardinality)
  }
  // Versionless protocol fixtures and current projected snapshots use scalar
  // event rows. Current snapshots may contain owner-restored scrub tokens such
  // as `{{tools}}`; semantic replay restores those sidecars, while this layout
  // gate owns only envelopes, source-event ranges, and one-event-per-row form.
  const projectedCurrent = headerValue !== null
    && typeof headerValue === 'object'
    && !Array.isArray(headerValue)
    && (headerValue as Record<string, unknown>).version === sessionFormatCatalog.currentVersion
  if (headerValue === null || typeof headerValue !== 'object' || Array.isArray(headerValue)
    || !Object.hasOwn(headerValue, 'version') || projectedCurrent) {
    return rows.map((source, index) => {
      const record = { ...source }
      try {
        if (record.type === 'text-chunks'
          || record.type === 'reasoning-chunks'
          || record.type === 'tool-call-chunks') {
          throw new Error('current projected fixtures cannot contain legacy packed rows')
        }
        if (Object.hasOwn(record, 'sourceEventSeqs')) {
          record.sourceEventSeqs = decodeSeqRanges(record.sourceEventSeqs)
        }
        return record as unknown as SessionEvent
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        throw new Error(`session snapshot line ${rowLines[index] ?? 1}: ${detail}`, { cause: error })
      }
    })
  }
  const collector = new SessionFormatEventCollector()
  let decoder: SessionFormatArtifactDecoder
  try {
    const version = (headerValue as Record<string, unknown>).version
    const codec = historicalCodecs.find(candidate => candidate.version === version)
    if (codec === undefined) throw new Error(`unsupported session fixture version ${String(version)}`)
    decoder = codec.createDecoder(validationHeader(headerValue), 'strict')
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`session snapshot line 1: ${detail}`, { cause: error })
  }
  for (const [index, row] of rows.entries()) {
    try {
      decoder.decodeRow(row, collector)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`session snapshot line ${rowLines[index] ?? 1}: ${detail}`, { cause: error })
    }
  }
  try {
    decoder.finish(collector)
    return [...collector.values] as unknown as SessionEvent[]
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    const line = fixtureDiagnosticLine(error, rowLines, eventLines)
    throw new Error(`session snapshot line ${line}: ${detail}`, { cause: error })
  }
}

function fixtureDiagnosticLine(
  error: unknown,
  rowLines: readonly number[],
  eventLines: readonly number[],
): number {
  const detail = error instanceof Error && error.cause instanceof Error
    ? error.cause.message
    : error instanceof Error ? error.message : String(error)
  const physicalRow = /^released Session row (\d+)/.exec(detail)
  if (physicalRow !== null) return rowLines[Number(physicalRow[1])] ?? 1
  const event = /Session event (\d+)/.exec(detail)
    ?? / at seq (\d+)/.exec(detail)
    ?? /inherited Session cut (\d+)/.exec(detail)
  return event === null ? 1 : eventLines[Number(event[1])] ?? 1
}
