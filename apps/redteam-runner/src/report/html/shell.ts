/**
 * THE HTML document template — the single wrapper every HTML artifact is
 * rendered through.
 *
 * There used to be two: the design-system renderer emitted its own document
 * head, and report/html.ts (used for the compliance pack, the attestation
 * letter and the safety manifest) emitted a second one with its own stylesheet.
 * That meant two designs shipping from one deliverable folder. This module is
 * now the only place a `<!doctype html>` is produced.
 *
 * A caller supplies a title and an already-rendered body; the chrome, the
 * stylesheet and the copy script are identical for every document.
 */
import { esc } from './tokens.js'
import { COPY_SCRIPT, REPORT_CSS } from './style.js'

export interface HtmlDocumentInput {
  /** Page title: "<document title> — <target>". */
  title: string
  /** The rendered body sections, already joined. */
  body: string
}

/** Render one complete, self-contained HTML document. */
export function renderHtmlDocument(o: HtmlDocumentInput): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="generator" content="SecScan RedTeam">
<meta name="robots" content="noindex,nofollow">
<title>${esc(o.title)}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<div class="wrap">
${o.body}
</div>
${COPY_SCRIPT}
</body>
</html>`
}
