/**
 * Route paths and wire payloads shared verbatim by the host share routes and
 * the browser package (`@deepseek-ai/dsh-client-ui-redteam-console`),
 * published as the `./shared` subpath. Browser-safe: constants and types
 * only. Each route carries the absolute pathname the Host registers beside
 * the document-relative form the browser addresses.
 */

/**
 * Prefix route path carrying the whole share surface: the console `/api`
 * proxy lives under it (`<prefix>/api/...`) and the Arsenal bridge beside it
 * (`<prefix>/arsenal`).
 */
export const CONSOLE_SHARE_PREFIX_PATH = '/redteam-console'

/** Browser-relative form of {@link CONSOLE_SHARE_PREFIX_PATH}. */
export const CONSOLE_SHARE_PREFIX_ROUTE = CONSOLE_SHARE_PREFIX_PATH.slice(1)

/** POST route path bridging the console's read-only Arsenal MCP tools. */
export const CONSOLE_SHARE_ARSENAL_PATH = '/redteam-console/arsenal'

/** Browser-relative form of {@link CONSOLE_SHARE_ARSENAL_PATH}. */
export const CONSOLE_SHARE_ARSENAL_ROUTE = CONSOLE_SHARE_ARSENAL_PATH.slice(1)

/**
 * The only MCP tools the Arsenal bridge forwards. The console's `/mcp`
 * endpoint also carries engagement-driving and executor tools; those stay
 * model-facing and are never reachable from the browser through this bridge.
 */
export const ARSENAL_TOOL_NAMES = ['arsenal_search', 'arsenal_browse', 'arsenal_recommend'] as const

/** One forwardable Arsenal tool name. */
export type ArsenalToolName = typeof ARSENAL_TOOL_NAMES[number]

/** Arsenal bridge request body: one allowlisted tool plus its arguments. */
export interface ConsoleShareArsenalPayload {
  /** Tool name; must be one of {@link ARSENAL_TOOL_NAMES}. */
  readonly tool: string
  /** Tool arguments, forwarded verbatim as the JSON-RPC `arguments`. */
  readonly arguments?: Record<string, unknown>
}

/**
 * The engagement deliverable set the runner writes at every engagement
 * close (Q-DELIVERABLES-AUTOFIRE), in package order with the package zip
 * last. The runner console serves each one, byte for byte, at
 * `/api/engagements/<id>/deliverables/<file>`; the share proxy carries
 * that route to the browser under the prefix, so every chat surface —
 * the engagement-report document card and the Reports library alike —
 * addresses deliverables through {@link deliverableFileRoute} and this
 * one list. It mirrors the runner's `DELIVERABLE_FILES`; the runner's
 * route refuses any name outside its own copy of the list.
 */
export const DELIVERABLE_FILE_NAMES = [
  'report.html',
  'report.md',
  'report.json',
  'report.txt',
  'findings.csv',
  'report.docx',
  'report-package.zip',
] as const

/** One deliverable file name from {@link DELIVERABLE_FILE_NAMES}. */
export type DeliverableFileName = typeof DELIVERABLE_FILE_NAMES[number]

/**
 * Narrow an arbitrary string to a deliverable file name.
 * @param value - the candidate file name.
 * @returns whether the value names one deliverable file.
 */
export function isDeliverableFileName(value: string): value is DeliverableFileName {
  return (DELIVERABLE_FILE_NAMES as readonly string[]).includes(value)
}

/**
 * Whether a deliverable's content is text a Copy action can place on the
 * clipboard verbatim. The DOCX and the package zip are binary containers:
 * they carry a Download action only, and surfaces say so rather than
 * offering a copy that would paste garbage.
 * @param file - the deliverable file name.
 * @returns whether the file is text-native.
 */
export function isCopyableDeliverable(file: DeliverableFileName): boolean {
  return file !== 'report.docx' && file !== 'report-package.zip'
}

/**
 * Browser-relative share route for one deliverable file of one
 * engagement. The Host proxy attaches the console bearer; the browser
 * never sees the console's address or token.
 * @param id - the engagement id.
 * @param file - the deliverable file name.
 * @returns the document-relative route the browser fetches or downloads.
 */
export function deliverableFileRoute(id: string, file: DeliverableFileName): string {
  return `${CONSOLE_SHARE_PREFIX_ROUTE}/api/engagements/${encodeURIComponent(id)}/deliverables/${encodeURIComponent(file)}`
}

/**
 * Browser-relative share route for the in-thread display of a
 * deliverable: the deliverable route plus the `display=inline` marker
 * the runner console's deliverable route answers — for report.html
 * only — with an inline disposition under its display CSP (S6-H4b).
 * Only ever used as a sandboxed frame's `src`; the download path keeps
 * addressing {@link deliverableFileRoute} and never carries the marker.
 * @param id - the engagement id.
 * @param file - the deliverable file name.
 * @returns the document-relative display route for the file.
 */
export function deliverableDisplayRoute(id: string, file: DeliverableFileName): string {
  return `${deliverableFileRoute(id, file)}?display=inline`
}

/** Error payload every share route answers with on a refused or failed call. */
export interface ConsoleShareErrorPayload {
  /** Stable machine-readable failure code. */
  readonly code: string
  /** Human-readable failure detail. */
  readonly message: string
}
