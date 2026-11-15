/** Catalogue of the persisted event-envelope types and the surface-eligible event subset. */

import { globSync, readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import ts from 'typescript'
import { parseJsDoc, pointer, rawJsDoc, reportViolations } from './jsdoc.ts'
import { declarationText } from './persistence-catalog-declaration.ts'
import { packageNameFor, root, SESSION_PACKAGE } from './persistence-catalog-scan.ts'
import {
  EVENT_ENVELOPE_TYPE_NAMES,
  type EventEnvelopeTypeEntry,
  type EventEnvelopeTypeName,
  type LogEventEntry,
  type AnnotatedLogEventEntry,
} from './persistence-catalog-types.ts'

/**
 * Collect the exported declarations that compose the persisted event envelope,
 * preserving their source JSDoc and declaration text.
 * @param scanRoot - the tree whose workspace package sources are scanned.
 * @returns one entry per envelope type, in `EVENT_ENVELOPE_TYPE_NAMES` order.
 */
export function collectEventEnvelopeTypes(scanRoot: string = root): EventEnvelopeTypeEntry[] {
  const found = new Map<EventEnvelopeTypeName, EventEnvelopeTypeEntry>()
  const violations: string[] = []
  const wanted = new Set<string>(EVENT_ENVELOPE_TYPE_NAMES)
  for (const rel of globSync('packages/*/*/src/**/*.{ts,tsx}', { cwd: scanRoot }).map(s => s.split(sep).join('/')).sort()) {
    const abs = resolve(scanRoot, rel)
    const text = readFileSync(abs, 'utf8')
    if (!EVENT_ENVELOPE_TYPE_NAMES.some(name => text.includes(name))) continue
    if (packageNameFor(rel, scanRoot) !== SESSION_PACKAGE) continue
    const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true)
    for (const stmt of sf.statements) {
      if (!ts.isTypeAliasDeclaration(stmt) || !wanted.has(stmt.name.text)) continue
      const name = stmt.name.text as EventEnvelopeTypeName
      const src = pointer(rel, sf, stmt)
      const where = `event-envelope type '${name}' (${src})`
      const prior = found.get(name)
      if (prior) {
        violations.push(`${where} is already declared at ${prior.source}; the persisted envelope type has exactly one owner.`)
        continue
      }
      if (!(stmt.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ?? false)) {
        violations.push(`${where} is not exported.`)
      }
      const { doc, hasMode } = parseJsDoc(rawJsDoc(text, stmt))
      if (hasMode) violations.push(`${where} carries an @mode tag, but a persisted type has no dispatch mode.`)
      if (!doc) violations.push(`${where} has no description prose. The full JSDoc is part of the generated catalog.`)
      found.set(name, { name, declaration: declarationText(text, sf, stmt), source: src })
    }
  }
  const missing = EVENT_ENVELOPE_TYPE_NAMES.filter(name => !found.has(name))
  if (missing.length > 0) {
    violations.push(`missing event-envelope declaration(s): ${missing.join(', ')}.`)
  }
  reportViolations('gen-persistence-catalog', violations)
  return EVENT_ENVELOPE_TYPE_NAMES.map((name) => {
    const entry = found.get(name)
    if (!entry) throw new Error(`gen-persistence-catalog: missing checked event-envelope declaration '${name}'.`)
    return entry
  })
}

/**
 * Parse the `SurfaceEventType` union — the surface-eligible subset of event
 * types — from source. Hard-errors when the alias is missing, declared more
 * than once, or contains a non-string-literal member: the badge derivation
 * relies on the union being a closed set of literal event names.
 * `scanRoot` defaults to the repo root; tests pass a fixture dir.
 * @param scanRoot - the tree whose workspace package sources are scanned.
 * @returns the surface-eligible event names.
 */
export function collectSurfaceEventTypes(scanRoot: string = root): string[] {
  const found: { names: string[]; source: string }[] = []
  for (const rel of globSync('packages/*/*/src/**/*.{ts,tsx}', { cwd: scanRoot }).map(s => s.split(sep).join('/')).sort()) {
    const abs = resolve(scanRoot, rel)
    const text = readFileSync(abs, 'utf8')
    if (!text.includes('SurfaceEventType')) continue
    const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true)
    for (const stmt of sf.statements) {
      if (!ts.isTypeAliasDeclaration(stmt) || stmt.name.text !== 'SurfaceEventType') continue
      const src = pointer(rel, sf, stmt)
      const members = ts.isUnionTypeNode(stmt.type) ? [...stmt.type.types] : [stmt.type]
      const names: string[] = []
      for (const m of members) {
        if (ts.isLiteralTypeNode(m) && ts.isStringLiteral(m.literal)) names.push(m.literal.text)
        else throw new Error(`gen-persistence-catalog: SurfaceEventType (${src}) has a non-string-literal member; the badge derivation needs a closed literal union.`)
      }
      found.push({ names, source: src })
    }
  }
  const only = found[0]
  if (!only) throw new Error('gen-persistence-catalog: no SurfaceEventType union found under packages/*/*/src.')
  if (found.length > 1) throw new Error(`gen-persistence-catalog: SurfaceEventType is declared more than once (${found.map(f => f.source).join(', ')}); the surface subset has exactly one owner.`)
  return only.names
}

/**
 * Attach the surface/log-only badge to each event. Hard-errors when a
 * `SurfaceEventType` union member names no collected event — a stale union
 * member would otherwise silently badge nothing.
 * @param events - the collected log events to badge.
 * @param surfaceTypes - the surface-eligible event names.
 * @returns each event annotated with its surface badge.
 */
export function annotateSurface(events: LogEventEntry[], surfaceTypes: string[]): AnnotatedLogEventEntry[] {
  const names = new Set(events.map(e => e.name))
  const stale = surfaceTypes.filter(t => !names.has(t))
  if (stale.length > 0) {
    throw new Error(`gen-persistence-catalog: SurfaceEventType member(s) ${stale.map(t => `'${t}'`).join(', ')} name no declared log event (stale union member?).`)
  }
  const surface = new Set(surfaceTypes)
  for (const event of events) {
    if (event.messageProjection && surface.has(event.name)) {
      throw new Error(`gen-persistence-catalog: '${event.name}' cannot declare both a message projection and surface operations.`)
    }
  }
  return events.map(e => ({ ...e, surface: surface.has(e.name) }))
}
