/** Catalogue of every `SessionEventMap` member declared across the workspace packages. */

import { globSync, readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import ts from 'typescript'
import { parseJsDoc, pointer, rawJsDoc, reportViolations } from './jsdoc.ts'
import { declarationText, payloadText } from './persistence-catalog-declaration.ts'
import { packageNameFor, root, sessionEventMapDecls, SESSION_PACKAGE, SESSION_TYPES_MODULE } from './persistence-catalog-scan.ts'
import type { LogEventEntry } from './persistence-catalog-types.ts'

/**
 * Collect every `SessionEventMap` merge, rejecting inherited, non-literal,
 * untyped, undocumented, duplicate, or incorrectly owned members in one report.
 * @param scanRoot - the tree whose workspace package sources are scanned.
 * @returns one entry per declared log event, in declaration order.
 */
export function collectLogEvents(scanRoot: string = root): LogEventEntry[] {
  const entries: LogEventEntry[] = []
  const violations: string[] = []
  const seen = new Map<string, string>()
  let owningDecl: string | null = null
  for (const rel of globSync('packages/*/*/src/**/*.{ts,tsx}', { cwd: scanRoot }).map(s => s.split(sep).join('/')).sort()) {
    const abs = resolve(scanRoot, rel)
    const text = readFileSync(abs, 'utf8')
    if (!text.includes('SessionEventMap')) continue
    const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true)
    for (const { decl, topLevel } of sessionEventMapDecls(sf)) {
      const declSrc = pointer(rel, sf, decl)
      if (topLevel) {
        // The top-level form has one home: the single exported declaration in
        // the owning package. Same-named interfaces elsewhere are different
        // types and must not enter the on-disk catalog.
        const pkg = packageNameFor(rel, scanRoot)
        if (pkg !== SESSION_PACKAGE) {
          violations.push(`top-level interface SessionEventMap (${declSrc}) is outside ${SESSION_PACKAGE} (package ${pkg ?? 'unknown'}). Rename the interface, or contribute events via declare module '${SESSION_TYPES_MODULE}'.`)
          continue
        }
        const exported = decl.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ?? false
        if (!exported) {
          violations.push(`top-level interface SessionEventMap (${declSrc}) is not exported; the owning vocabulary is the single exported declaration — rename a local helper interface.`)
          continue
        }
        if (owningDecl) {
          violations.push(`top-level interface SessionEventMap (${declSrc}) is already declared at ${owningDecl}; the owning vocabulary has exactly one home.`)
          continue
        }
        owningDecl = declSrc
      }
      if (decl.heritageClauses?.length) {
        violations.push(`SessionEventMap declaration (${declSrc}) uses extends; inherited keys would join keyof SessionEventMap without a catalog row — declare event members directly.`)
      }
      for (const member of decl.members) {
        const src = pointer(rel, sf, member)
        if (!ts.isPropertySignature(member) || !member.type) {
          // A method-form or type-less member still joins `keyof SessionEventMap`,
          // so skipping it silently would be exactly the undocumented-event hole
          // this catalog exists to close.
          const label = (member as { name?: ts.Node }).name?.getText(sf) ?? member.getText(sf).replace(/\s+/g, ' ')
          violations.push(`SessionEventMap member ${label} (${src}) is not a property signature with an explicit payload type; declare every log event as 'scope/name': <payload>.`)
          continue
        }
        if (!ts.isStringLiteral(member.name)) {
          violations.push(`log event at ${src} has a non-literal name; the catalog needs string-literal event names.`)
          continue
        }
        const name = member.name.text
        const where = `log event '${name}' (${src})`
        const prior = seen.get(name)
        if (prior) {
          violations.push(`${where} is already declared at ${prior}; an event type has exactly one declaration.`)
          continue
        }
        seen.set(name, src)
        const payload = payloadText(member.type, sf)
        const { doc, hasMode } = parseJsDoc(rawJsDoc(text, member))
        if (hasMode) {
          violations.push(`${where} carries an @mode tag, but a log event has no dispatch mode (it is not a cordis bus event — it rides the 'session/event' emit). Remove the tag.`)
        }
        if (!doc) {
          violations.push(`${where} has no description prose. Say what the event records and what its payload means — the JSDoc becomes the catalog entry.`)
        }
        const declaration = declarationText(text, sf, member)
        const messageProjection = ts.getJSDocTags(member).some(tag => tag.tagName.text === 'messageProjection')
        entries.push({ name, scope: name.split('/')[0] ?? name, payload, declaration, doc, source: src, ...messageProjection ? { messageProjection: true as const } : {} })
      }
    }
  }
  reportViolations('gen-persistence-catalog', violations)
  return entries
}
