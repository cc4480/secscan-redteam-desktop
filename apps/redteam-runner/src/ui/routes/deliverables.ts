/**
 * Deliverable file route (Q-DOC-ACTIONS): stream one file of an
 * engagement's closing deliverable set, byte for byte — as a download,
 * or, for report.html alone on an explicitly marked request, inline
 * for the chat thread's sandboxed preview frame (S6-H4b).
 *
 * The chat client offers Copy/Download on the documents a finished scan
 * produced; the bytes cross only here, streamed (the package zip can
 * carry every proof bundle). The file name is refused unless it is one
 * of the deliverable set's own names (DELIVERABLE_FILES) — no other
 * engagement-directory file (state, events, proof bundles) is reachable
 * through this route, and the engagement id passes the store's
 * traversal guard like every other route. A missing file is a 404: the
 * client renders that name as a gap with no actions, matching the
 * autofire contract that an incomplete set never reads as complete.
 * HEAD answers the same headers with no body — the client's download
 * action probes with HEAD before handing the route to the browser's
 * download manager (the session-log export pattern).
 *
 * The display variant is opt-in per request: `?display=inline` on
 * report.html — and only that exact marker on that one file — answers
 * with an inline disposition under DISPLAY_CSP instead of the download
 * disposition. A report.html can be Scribe-authored and carry inline
 * script; the bytes are served unchanged and inerted by the response
 * context (the CSP's `sandbox` directive and `script-src 'none'`,
 * plus the frame's own empty sandbox attribute), never sanitized or
 * rewritten. Every unmarked request, every other file, and every other
 * marker value keeps the download response byte for byte.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { DELIVERABLE_FILES } from '../../report/deliverables.js'
import type { UiStore } from '../store.js'
import { json } from './http.js'

const CONTENT_TYPES: Record<string, string> = {
  'report.html': 'text/html; charset=utf-8',
  'report.md': 'text/markdown; charset=utf-8',
  'report.json': 'application/json; charset=utf-8',
  'report.txt': 'text/plain; charset=utf-8',
  'findings.csv': 'text/csv; charset=utf-8',
  'report.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'report-package.zip': 'application/zip',
}

/**
 * Content-Security-Policy of the display variant: the report renders
 * its inline styles and data: images/fonts, and nothing else — no
 * script, no connections, no forms, no framing by any origin but the
 * console's own. The trailing `sandbox` directive puts the framed
 * document in an opaque origin even if a client drops the frame's
 * sandbox attribute.
 */
const DISPLAY_CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox"

/**
 * GET|HEAD /api/engagements/:id/deliverables/:file — the file's exact
 * bytes with an attachment disposition, or 404 when the engagement or
 * the deliverable does not exist. With the exact query marker
 * `display=inline` on report.html, the same bytes are served inline
 * under DISPLAY_CSP for the thread's preview frame instead.
 */
export function handleDeliverable(
  store: UiStore,
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  file: string,
  query: URLSearchParams,
): void {
  if (!(DELIVERABLE_FILES as readonly string[]).includes(file)) {
    json(res, 404, { error: 'not a deliverable file' })
    return
  }
  const artifact = store.openArtifact(id, file)
  if (artifact === null) {
    json(res, 404, { error: 'deliverable not found' })
    return
  }
  if (file === 'report.html' && query.get('display') === 'inline') {
    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[file] ?? 'application/octet-stream',
      'Content-Length': artifact.size,
      'Content-Disposition': `inline; filename="${file}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': DISPLAY_CSP,
    })
  } else {
    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[file] ?? 'application/octet-stream',
      'Content-Length': artifact.size,
      'Content-Disposition': `attachment; filename="${file}"`,
      'Cache-Control': 'no-store',
    })
  }
  if (req.method === 'HEAD') {
    artifact.stream.destroy()
    res.end()
    return
  }
  artifact.stream.pipe(res)
  // A browser that goes away mid-download ends the file read with it.
  res.on('close', () => { artifact.stream.destroy() })
}
