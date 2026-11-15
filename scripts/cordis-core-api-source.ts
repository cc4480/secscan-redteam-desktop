/**
 * Source access for the Cordis core API reference: the per-render scan context,
 * the cached parse of each declaration file, and dedented JSDoc reads.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { rawJsDoc } from './jsdoc.ts'

/** One render's scan root, parsed-source cache, and collected JSDoc violations. */
export interface RenderContext {
  scanRoot: string
  cache: Map<string, { sf: ts.SourceFile; text: string }>
  violations: string[]
}

/**
 * Load one scan-root-relative source file, parsed once per render.
 * @param ctx - render state holding the cache.
 * @param rel - scan-root-relative path of the source file.
 * @returns the parsed source file together with its raw text.
 */
export function load(ctx: RenderContext, rel: string): { sf: ts.SourceFile; text: string } {
  const cached = ctx.cache.get(rel)
  if (cached !== undefined) return cached
  const text = readFileSync(resolve(ctx.scanRoot, rel), 'utf8')
  const entry = { sf: ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true), text }
  ctx.cache.set(rel, entry)
  return entry
}

/**
 * Read a declaration's JSDoc with its own indentation stripped from every
 * continuation line, so a nested member's doc starts at column zero.
 * @param text - raw text of the file the node belongs to.
 * @param sf - parsed source file of that same text.
 * @param node - declaration whose JSDoc is read.
 * @returns the dedented JSDoc text, or an empty string when the node has none.
 */
export function sourceJsDoc(text: string, sf: ts.SourceFile, node: ts.Node): string {
  const raw = rawJsDoc(text, node)
  if (raw === '') return ''
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
  const lineStart = sf.getPositionOfLineAndCharacter(line, 0)
  const indent = text.slice(lineStart, node.getStart(sf))
  return raw.split('\n')
    .map((sourceLine, index) => index > 0 && sourceLine.startsWith(indent)
      ? sourceLine.slice(indent.length)
      : sourceLine)
    .join('\n')
}
