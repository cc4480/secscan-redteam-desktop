/**
 * Diagnostics and path identity: render a compiler diagnostic, canonicalize a path, and order the outputs that carry either.
 *
 * @module @deepseek-ai/dsh-typert-generator/analyzer-diagnostic
 */

import { existsSync, realpathSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import ts from 'typescript'
import type { CrossFaceLink, TypertFace } from './model.ts'

/** Flatten one compiler diagnostic into a single message. */
export function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
}

/** Render one program diagnostic with its analyzed face and source position. */
export function formatProgramDiagnostic(root: string, face: TypertFace, diagnostic: ts.DiagnosticWithLocation): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
  const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
  const file = slash(relative(root, diagnostic.file.fileName))
  return `typert(${face}): ${file}:${String(position.line + 1)}:${String(position.character + 1)}: TypeScript TS${String(diagnostic.code)}: ${message}`
}

/** Canonical paths already resolved, reused for the process lifetime. */
export const realPathCache = new Map<string, string>()

/** The canonical absolute form of one path. */
export function realPath(path: string): string {
  const absolute = resolve(path)
  const cached = realPathCache.get(absolute)
  if (cached !== undefined) return cached
  // Only existing paths are memoized: a path can come into existence later,
  // but an existing path's canonical form is stable for the process lifetime
  // (analysis edits rewrite file contents, never the directory tree).
  if (!existsSync(absolute)) return absolute
  const resolved = realpathSync(absolute)
  realPathCache.set(absolute, resolved)
  return resolved
}

/** Whether one path sits at or under one root after canonicalization. */
export function isWithin(path: string, root: string): boolean {
  const absolute = realPath(path)
  const parent = realPath(root)
  return absolute === parent || absolute.startsWith(parent + sep)
}

/** Normalize backslashes to forward slashes. */
export function slash(value: string): string {
  return value.replaceAll('\\', '/')
}

/** The first value seen for each key, in encounter order. */
export function uniqueBy<T>(values: readonly T[], key: (value: T) => string): T[] {
  const result = new Map<string, T>()
  for (const value of values) if (!result.has(key(value))) result.set(key(value), value)
  return [...result.values()]
}

/** Total sort order over cross-face links. */
export function compareCrossFaceLinks(left: CrossFaceLink, right: CrossFaceLink): number {
  return left.fromFace.localeCompare(right.fromFace)
    || left.fromPackage.localeCompare(right.fromPackage)
    || left.toFace.localeCompare(right.toFace)
    || left.toPackage.localeCompare(right.toPackage)
    || left.subpath.localeCompare(right.subpath)
    || left.name.localeCompare(right.name)
}
