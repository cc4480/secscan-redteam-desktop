/** Canonical projection of one repository session fixture document. */

import { deepStrictEqual } from 'node:assert'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import {
  isSessionHeader,
  parseFixtureRows,
  renderFixture,
  withoutEnvelope,
} from './session-fixture-layout-rows.ts'

/**
 * Canonicalize one JSONL document when its first record is a session header.
 * Historical generations receive strict source-codec validation and remain byte-identical;
 * conversion to the current format is not required. Current body records re-encode
 * one event per row and omit storage sequence/time envelopes; their header is preserved.
 * Non-session JSONL returns undefined.
 *
 * @param content - JSONL source text.
 * @param label - path-like diagnostic label.
 * @returns Canonical text for a session fixture, otherwise undefined.
 */
export function canonicalSessionFixture(content: string, label = '<session-fixture>'): string | undefined {
  const headerLine = content.split(/\r?\n/).find(line => line.trim().length > 0)
  if (headerLine === undefined) return undefined

  let headerValue: unknown
  try {
    headerValue = JSON.parse(headerLine)
  } catch {
    return undefined
  }
  if (!isSessionHeader(headerValue)) return undefined

  let events
  try {
    events = parseFixtureRows(content, headerValue)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`${label}: ${detail}`, { cause: error })
  }
  const storedVersion = headerValue !== null
    && typeof headerValue === 'object'
    && !Array.isArray(headerValue)
    && typeof (headerValue as Record<string, unknown>).version === 'number'
    ? (headerValue as Record<string, number>).version
    : undefined
  // Released predecessor generations are immutable compatibility fixtures.
  // Parsing above still validates their physical rows, but canonicalization
  // never rewrites their committed bytes into the current scalar layout.
  if (storedVersion !== undefined && storedVersion < sessionFormatCatalog.currentVersion) {
    return content
  }
  const canonical = renderFixture(headerLine, events)
  const decoded = parseFixtureRows(canonical, headerValue)
  try {
    deepStrictEqual(withoutEnvelope(decoded), withoutEnvelope(events))
  } catch (error) {
    throw new Error(`${label}: packed snapshot rewrite changed the event payload stream`, { cause: error })
  }
  if (renderFixture(headerLine, decoded) !== canonical) {
    throw new Error(`${label}: packed rewrite is not idempotent`)
  }
  return canonical
}
