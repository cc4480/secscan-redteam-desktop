/**
 * How the generated catalog writes TypeScript literals: single-quoted strings,
 * compact string arrays, structured parameter records, and first-sentence
 * summaries.
 *
 * @module @deepseek-ai/dsh-typert-generator/cordis-catalog-literals
 */

/** Render one value as a single-quoted TypeScript literal. */
export function quote(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll('\n', '\\n')}'`
}

/** Render a compact TypeScript string-array literal. */
export function quoteList(values: readonly string[]): string {
  return `[${values.map(quote).join(', ')}]`
}

/** Render structured parameter documentation as a compact TypeScript literal. */
export function renderParameters(parameters: ReadonlyMap<string, string>): string {
  const values = [...parameters].map(([name, description]) => (
    `{ name: ${quote(name)}, description: ${quote(description)} }`
  ))
  return `[${values.join(', ')}]`
}

export function firstSentence(doc: string): string {
  const line = doc.split('\n', 1)[0] ?? ''
  const match = /^(.*?[.!?])(?:\s|$)/.exec(line)
  return (match?.[1] ?? line).trim()
}
