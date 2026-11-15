/**
 * JSDoc handling shared by the catalog's scan and its entry projection: turning a
 * declaration's comment into registrant-facing prose, its one-line summary, and
 * its authored example block.
 */

/** JSDoc prose: comment markers and block tags removed, paragraphs kept. */
export function docProse(jsDoc: string): string {
  const lines = jsDoc.replace(/^\/\*\*/, '').replace(/\*\/$/, '').split('\n')
    .map(line => line.replace(/^\s*\*?\s?/, '').replace(/\s+$/, ''))
  const kept: string[] = []
  for (const line of lines) {
    if (line.trimStart().startsWith('@')) break
    kept.push(line)
  }
  return kept.join('\n').replace(/\{@link\s+([^}]+)\}/g, '$1').replace(/\n{3,}/g, '\n\n').trim()
}

/** First sentence of a prose block, for the compact listing. */
export function firstSentence(doc: string): string {
  const flat = doc.replace(/\s+/g, ' ').trim()
  const match = /^(.*?[.!?])(?:\s|$)/.exec(flat)
  return (match?.[1] ?? flat).trim()
}

/** One multiline JSDoc block tag, without comment decoration. */
export function blockTag(jsDoc: string, name: string): string | undefined {
  const lines = jsDoc.replace(/^\/\*\*/, '').replace(/\*\/$/, '').split('\n')
    .map(line => line.replace(/^\s*\*?\s?/, '').replace(/\s+$/, ''))
  const start = lines.findIndex(line => line === `@${name}` || line.startsWith(`@${name} `))
  if (start < 0) return undefined
  const body = [lines[start]?.slice(name.length + 1).trimStart() ?? '']
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('@')) break
    body.push(line)
  }
  const value = body.join('\n').trim()
  return value === '' ? undefined : value
}
