/** Which package owns a scanned source file, and where the merged event map lives. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'

/** Repository root the catalogued collectors default their `scanRoot` argument to. */
export const root = resolve(import.meta.dirname, '..')

/** The package that owns the durable event vocabulary. */
export const SESSION_PACKAGE = '@deepseek-ai/dsh-session'

/** The type-only module that plugin declaration merges augment. */
export const SESSION_TYPES_MODULE = '@deepseek-ai/dsh-session/types'

/**
 * Every `interface SessionEventMap` declaration in a source file: the owning
 * top-level declaration (in `@deepseek-ai/dsh-session`) and any declaration
 * merge inside a `declare module '@deepseek-ai/dsh-session/types'` block. Both forms
 * declare members of the SAME merged interface, so both are catalogued
 * uniformly. `topLevel` distinguishes the owning form so the caller can verify
 * it actually lives in the owning package — an unrelated local interface that
 * happens to share the name must not be catalogued as the on-disk vocabulary.
 * @param sf - the parsed source file to inspect.
 * @returns each event-map declaration with whether it is the top-level owning form.
 */
export function sessionEventMapDecls(sf: ts.SourceFile): { decl: ts.InterfaceDeclaration; topLevel: boolean }[] {
  const decls: { decl: ts.InterfaceDeclaration; topLevel: boolean }[] = []
  for (const stmt of sf.statements) {
    if (ts.isInterfaceDeclaration(stmt) && stmt.name.text === 'SessionEventMap') decls.push({ decl: stmt, topLevel: true })
    if (ts.isModuleDeclaration(stmt) && ts.isStringLiteral(stmt.name) && stmt.name.text === SESSION_TYPES_MODULE
      && stmt.body && ts.isModuleBlock(stmt.body)) {
      for (const inner of stmt.body.statements) {
        if (ts.isInterfaceDeclaration(inner) && inner.name.text === 'SessionEventMap') decls.push({ decl: inner, topLevel: false })
      }
    }
  }
  return decls
}

/**
 * The npm package name owning a `packages/<group>/<pkg>/…` source file, read
 * from that package's manifest — or null when the manifest is missing or
 * unparseable (the caller treats null as "ownership unverifiable").
 * @param rel - slash-separated path of the source file, relative to `scanRoot`.
 * @param scanRoot - the root the scanned package paths resolve against.
 * @returns the owning package name, or null when the manifest cannot be read.
 */
export function packageNameFor(rel: string, scanRoot: string): string | null {
  const dir = rel.split('/').slice(0, 3).join('/')
  try {
    const manifest = JSON.parse(readFileSync(resolve(scanRoot, dir, 'package.json'), 'utf8')) as { name?: string }
    return typeof manifest.name === 'string' ? manifest.name : null
  } catch {
    // Missing or malformed package.json — every real workspace package has one,
    // so this only arises in stripped-down fixture trees; either way ownership
    // cannot be verified and the caller reports the declaration.
    return null
  }
}
