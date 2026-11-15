/**
 * The default Web entry: check `apps/web/index.html`'s module scripts and follow their imports.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { JSDOM } from 'jsdom'

/** Inputs the default Web entry scan needs from the isolation check. */
export interface WebEntryScan {
  root: string
  failures: string[]
  scanSource: (path: string, followLocal?: boolean, inlineSource?: string) => void
}

/**
 * Check the default Web entry's module scripts, following every runtime import each entry makes.
 * @param scan - repository root, the violation list to append to, and the source scanner.
 */
export function scanWebModuleEntries(scan: WebEntryScan): void {
  const html = resolve(scan.root, 'apps/web/index.html')
  if (!existsSync(html)) {
    scan.failures.push('missing default Web entry apps/web/index.html')
    return
  }
  const dom = new JSDOM(readFileSync(html, 'utf8'))
  try {
    const entries = [...dom.window.document.querySelectorAll('script[type="module"]')]
    if (entries.length === 0) scan.failures.push('apps/web/index.html: missing default module entry')
    for (const [index, entry] of entries.entries()) {
      const src = entry.getAttribute('src')
      if (src === null) {
        scan.scanSource(`${html}.inline-${String(index)}.js`, true, entry.textContent)
        continue
      }
      if (/^(?:https?:)?\/\//.test(src)) {
        scan.failures.push(`apps/web/index.html: external default module entry cannot be checked: ${src}`)
        continue
      }
      scan.scanSource(resolve(scan.root, 'apps/web', src.replace(/^\//, '')), true)
    }
  } finally {
    dom.window.close()
  }
}
