/**
 * Deliverable file actions for the Reports library: Copy and Download on
 * the autofire completion set, over the Phase 0 share routes.
 *
 * The pattern is the house session-log export pattern, as landed by
 * Q-DOC-ACTIONS for the in-thread report card: a download HEAD-probes the
 * deliverable's route first (a gap answers 404 and nothing is handed to
 * the download manager), then hands the route to an anchor; a copy GETs
 * the text and places it on the clipboard verbatim. Discipline (decided
 * by Q-DOC-ACTIONS, followed here): the 5-line `downloadUrl` anchor
 * helper is re-implemented in the owning package rather than imported
 * across feature plugins; the route and the file classification come
 * from the one shared contract module both surfaces use.
 */
import {
  deliverableFileRoute, isCopyableDeliverable, type DeliverableFileName,
} from '@secscan/redteam-console-share/shared'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * Hand a same-origin URL to the browser's download manager under a name.
 * @param url - the share route to download.
 * @param filename - the downloaded file's name.
 */
export function downloadUrl(url: string, filename: string): void {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
}

/**
 * Download one deliverable: probe, then hand off. Actions fire only on
 * click — nothing here runs in a render or poll path.
 * @param id - the engagement id.
 * @param file - the deliverable file name.
 * @returns whether the hand-off happened.
 */
export async function downloadDeliverable(id: string, file: DeliverableFileName): Promise<boolean> {
  const route = deliverableFileRoute(id, file)
  try {
    const probe = await fetch(route, { method: 'HEAD' })
    if (!probe.ok) return false
  } catch {
    return false
  }
  downloadUrl(route, file)
  return true
}

/**
 * Copy one deliverable's exact text to the clipboard. Binary containers
 * (DOCX, the package zip) refuse WITHOUT fetching — a copy of their bytes
 * would paste garbage; their rows offer Download only and say so.
 * @param id - the engagement id.
 * @param file - the deliverable file name.
 * @returns whether the clipboard now holds the file's text.
 */
export async function copyDeliverable(id: string, file: DeliverableFileName): Promise<boolean> {
  if (!isCopyableDeliverable(file)) return false
  try {
    const response = await fetch(deliverableFileRoute(id, file))
    if (!response.ok) return false
    const text = await response.text()
    return await writeClipboard(text)
  } catch {
    return false
  }
}
