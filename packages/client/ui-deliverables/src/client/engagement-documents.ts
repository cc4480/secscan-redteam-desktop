/**
 * Engagement deliverable documents: the model and the on-demand actions
 * behind the engagement-report document card (Q-DOC-ACTIONS).
 *
 * A finished engagement's closing set (Q-DELIVERABLES-AUTOFIRE) is named
 * by the `engagement_report` tool result: one path field per present
 * file, `reportPath` for the Markdown report, and a `deliverableGap`
 * sentence when part of the set is missing. This module turns that
 * result into the seven document rows the card renders — present files
 * with actions, missing files as labelled gaps with none — and performs
 * the two actions against the Host's console-share routes: the Host
 * proxy attaches the runner console's bearer server-side, so the
 * browser fetches same-origin relative routes and never sees the
 * console's address, token, or any filesystem path.
 */
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  DELIVERABLE_FILE_NAMES, deliverableFileRoute, isCopyableDeliverable, isDeliverableFileName,
  type DeliverableFileName,
} from '@secscan/redteam-console-share/shared'

export { DELIVERABLE_FILE_NAMES, type DeliverableFileName }

/** The engagement_report path field that names each deliverable file in the tool result. */
const PATH_FIELDS: Readonly<Record<DeliverableFileName, string>> = {
  'report.html': 'reportHtmlPath',
  'report.md': 'reportPath',
  'report.json': 'reportJsonPath',
  'report.txt': 'reportTxtPath',
  'findings.csv': 'findingsCsvPath',
  'report.docx': 'reportDocxPath',
  'report-package.zip': 'reportPackagePath',
}

/** One document row of the engagement-report card. */
export interface EngagementDocument {
  /** Deliverable file name, shown verbatim. */
  readonly file: DeliverableFileName
  /** Whether the closing set contains this file; false renders the gap row. */
  readonly present: boolean
  /** Whether a Copy action exists (text-native formats only). */
  readonly copyable: boolean
}

/** The Scribe gate's outcome for a closing set, as the engagement_report result's `signoff` field carries it. */
export interface EngagementSignoff {
  /** Whether the Scribe signed the closing set. */
  readonly signed: boolean
  /** Review cycles the set went through, when the result names them. */
  readonly cycles?: number
  /** Why the set shipped unsigned (`defects` or `scribe_unavailable`), when unsigned. */
  readonly reason?: string
  /** Count of the final cycle's defects, when unsigned. */
  readonly defectCount?: number
}

/** The parsed engagement_report result the card renders from. */
export interface EngagementReportDocuments {
  /** Engagement id the documents belong to. */
  readonly id: string
  /** The finished report's Markdown content, for delivery in the thread. */
  readonly content: string
  /** All seven deliverables, in package order (the package zip last). */
  readonly documents: readonly EngagementDocument[]
  /** Present deliverables exist (at least the Markdown report was named). */
  readonly ready: boolean
  /** The Scribe gate's outcome, or null when the result carries no usable signoff field (older results). */
  readonly signoff: EngagementSignoff | null
}

/**
 * Read the result's `signoff` field: the Scribe outcome, present only
 * when the field is an object carrying a boolean `signed`. An absent or
 * malformed field yields null — never a fabricated signing.
 * @param fields - the parsed tool-result fields.
 * @returns the signoff, or null when none was recorded.
 */
function parseSignoff(fields: Record<string, unknown>): EngagementSignoff | null {
  const raw = fields['signoff']
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  if (typeof value['signed'] !== 'boolean') return null
  return {
    signed: value['signed'],
    ...(typeof value['cycles'] === 'number' ? { cycles: value['cycles'] } : {}),
    ...(typeof value['reason'] === 'string' && value['reason'] !== '' ? { reason: value['reason'] } : {}),
    ...(typeof value['defectCount'] === 'number' ? { defectCount: value['defectCount'] } : {}),
  }
}

/**
 * Read an engagement_report tool result's text content: JSON text when
 * the endpoint wrapped the body, the body fields otherwise.
 * @param text - the tool result's text payload.
 * @returns the parsed fields, or null when the text is not a JSON object.
 */
function parseResultFields(text: string): Record<string, unknown> | null {
  let value: unknown
  try { value = JSON.parse(text) }
  catch { return null } // A non-JSON result is the generic row's material, not this card's.
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/** File names a deliverableGap sentence names as missing: `(missing: a, b)`. */
function gapFileNames(gap: string): ReadonlySet<string> {
  const match = /missing:\s*([^)]+)/.exec(gap)
  if (match === null) return new Set()
  return new Set((match[1] ?? '').split(',').map(name => name.trim()).filter(name => name !== ''))
}

/**
 * Build the document rows from an engagement_report tool result.
 *
 * Presence follows the autofire contract exactly: a file the result
 * names a path for is present; a file the deliverableGap sentence names
 * is a gap. When the gap sentence carries no file list, every unnamed
 * file is a gap — missing files are shown as gaps, never dropped and
 * never given dead actions.
 * @param text - the tool result's text payload.
 * @returns the parsed documents, or null when the result is not a ready report.
 */
export function engagementDocumentsFromResult(text: string): EngagementReportDocuments | null {
  const fields = parseResultFields(text)
  if (fields === null || fields['ready'] !== true || typeof fields['id'] !== 'string' || fields['id'] === '') return null
  const named = new Set<string>()
  for (const file of DELIVERABLE_FILE_NAMES) {
    const path = fields[PATH_FIELDS[file]]
    if (typeof path === 'string' && path !== '') named.add(file)
  }
  if (named.size === 0) return null
  const gap = typeof fields['deliverableGap'] === 'string' ? fields['deliverableGap'] : ''
  const gapNamed = gapFileNames(gap)
  const documents = DELIVERABLE_FILE_NAMES.map((file): EngagementDocument => ({
    file,
    present: named.has(file) && !gapNamed.has(file),
    copyable: isCopyableDeliverable(file),
  }))
  return {
    id: fields['id'],
    content: typeof fields['content'] === 'string' ? fields['content'] : '',
    documents,
    ready: true,
    signoff: parseSignoff(fields),
  }
}

/**
 * Hand a Host download route to the browser download manager, which
 * resolves it against the document's own base. This is the session-log
 * export's `downloadUrl` pattern (session-log-export/src/client/
 * controller.ts), re-implemented in this package: the client export
 * discipline bars a feature plugin from runtime-importing another
 * feature plugin's client value, so the five lines live with their
 * consumer rather than crossing that boundary.
 * @param url - document-relative Host download route.
 * @param filename - browser download filename.
 */
export function downloadUrl(url: string, filename: string): void {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
}

/** The two on-demand document actions, bound to one engagement. */
export interface EngagementDocumentActions {
  /**
   * Probe one deliverable's share route with HEAD, then hand the route
   * to the browser download manager under the file's own name (the
   * session-log export pattern: a failed probe publishes the failure
   * instead of dying as a navigation).
   * @param file - the deliverable file name.
   * @returns true when the route probed OK and the save was handed off.
   */
  download(file: DeliverableFileName): Promise<boolean>
  /**
   * Fetch one text deliverable's content and place it on the clipboard.
   * @param file - the deliverable file name (text-native formats only).
   * @returns the exact content written, or null when the write failed.
   */
  copy(file: DeliverableFileName): Promise<string | null>
}

/**
 * The production document actions for one engagement, over the Host's
 * console-share routes. Actions run only on an operator gesture: no
 * fetch happens at render, and nothing polls.
 * @param id - the engagement id.
 * @returns the actions the card's buttons invoke.
 */
export function createEngagementDocumentActions(id: string): EngagementDocumentActions {
  return {
    async download(file) {
      const route = deliverableFileRoute(id, file)
      const probe = await fetch(route, { method: 'HEAD' })
      if (!probe.ok) return false
      downloadUrl(route, file)
      return true
    },
    async copy(file) {
      if (!isDeliverableFileName(file) || !isCopyableDeliverable(file)) return null
      const response = await fetch(deliverableFileRoute(id, file))
      if (!response.ok) return null
      const text = await response.text()
      return await writeClipboard(text) ? text : null
    },
  }
}
