/** The generic pass: precompiled name patterns, skip lookup, and the per-file rewrite. */

import { RENAMES } from './rescope-vendor-renames.ts'
import { GENERIC_SKIPS } from './rescope-vendor-skips.ts'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** One name's rewrite, precompiled for both delimited forms. */
export interface Pattern {
  readonly upstream: string
  readonly from: string
  readonly to: string
  readonly token: RegExp
  readonly yamlName: RegExp
}

export function patterns(reverse: boolean): Pattern[] {
  return RENAMES
    .map(rename => ({
      upstream: rename.upstream,
      from: reverse ? rename.scoped : rename.upstream,
      to: reverse ? rename.upstream : rename.scoped,
    }))
    .sort((left, right) => right.from.length - left.from.length)
    .map(rename => ({
      ...rename,
      token: new RegExp(`(['"\`])${escapeRegExp(rename.from)}((?:/[^'"\`\\s]*)?)\\1`, 'g'),
      yamlName: new RegExp(`^(\\s*(?:-\\s*)?name:[ \\t]+)${escapeRegExp(rename.from)}([ \\t]*(?:#.*)?)$`, 'gm'),
    }))
}

function skipped(file: string, pattern: Pattern): boolean {
  return GENERIC_SKIPS.some(skip => skip.file === file && skip.upstream.includes(pattern.upstream))
}

function rewriteLine(line: string, file: string, all: readonly Pattern[]): string {
  let out = line
  for (const pattern of all) {
    if (skipped(file, pattern)) continue
    out = out.replace(pattern.token, (_match, quote: string, subpath: string) => `${quote}${pattern.to}${subpath}${quote}`)
    out = out.replace(pattern.yamlName, (_match, prefix: string, suffix: string) => `${prefix}${pattern.to}${suffix}`)
  }
  return out
}

/**
 * Rewrite a file's eligible lines.
 *
 * Markdown splits in two. Every fence is code a reader copies or a
 * configuration they mount, so every fence follows the rename regardless of its
 * info string. Prose follows it only under `docs/`, where a sentence quoting
 * `` `cordis` `` teaches an unresolved package name; elsewhere
 * prose is a record of what was true when it was written, and the same spelling
 * can mean something else entirely — the Python SDK's `cordis` option, or the
 * unvendored `@cordisjs/plugin-http`.
 */
export function rewrite(text: string, file: string, all: readonly Pattern[]): { text: string; lines: number } {
  const markdown = file.endsWith('.md')
  const prose = markdown && file.startsWith('docs/')
  let insideFence = false
  let lines = 0
  const out = text.split('\n').map((line) => {
    if (markdown) {
      if (/^\s*```/.test(line)) {
        insideFence = !insideFence
        return line
      }
      if (!insideFence && !prose) return line
    }
    const next = rewriteLine(line, file, all)
    if (next !== line) lines += 1
    return next
  })
  return { text: out.join('\n'), lines }
}

export function classify(file: string): string {
  if (/^vendor\/[^/]+\/package\.json$/.test(file)) return 'vendor manifest name'
  if (file.endsWith('package.json')) return 'package.json dependencies'
  if (/\.(ts|tsx|js|mjs|cjs|tpl)$/.test(file)) return 'code specifiers'
  if (/\.(yml|yaml)$/.test(file)) return 'YAML plugin names'
  if (file.endsWith('.json')) return 'JSON configuration'
  return 'Markdown fences and docs prose'
}
