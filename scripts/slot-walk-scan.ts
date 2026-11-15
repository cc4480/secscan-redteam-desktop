/**
 * The workspace scan: which files carry a slot contract merge or a registration
 * call, and the exported type-declaration index the catalog resolves owner
 * props through. Both read source text lexically — no type-checker program — so
 * the scan stays cheap over the whole workspace.
 */

import { globSync, readFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import ts from 'typescript'
import { declarationText, lineOf, scriptKindOf } from './slot-walk-text.ts'
import type { ScannedFile, TypeDeclaration } from './slot-walk-types.ts'

/** Cheap textual prefilter for a slot-contract merge, quote-style agnostic. */
const MERGE_HEAD = /declare module ['"]@deepseek-ai\/dsh-client-ui-slots['"]/

/** Cheap textual prefilter for a Slot or Factory registration call site. */
const REGISTER_HEAD = /\.(?:register|registerFactory)\(/

/**
 * Parse every file matching `patterns`, keeping the ones that carry a slot
 * contract merge or a registration call. Files without either are skipped so
 * the scan stays cheap over the whole workspace.
 * @param scanRoot - repository root the patterns resolve against.
 * @param patterns - glob(s) selecting the TypeScript/TSX files to scan.
 * @returns one entry per interesting file, in path order.
 */
export function scanSlotFiles(scanRoot: string, patterns: readonly string[]): ScannedFile[] {
  const out: ScannedFile[] = []
  const names = new Map<string, string>()
  const rels = [...new Set(globSync(patterns as string[], { cwd: scanRoot })
    .map(path => path.split(sep).join('/')))].sort()
  for (const rel of rels) {
    const abs = resolve(scanRoot, rel)
    const text = readFileSync(abs, 'utf8')
    if (!MERGE_HEAD.test(text) && !REGISTER_HEAD.test(text)) continue
    out.push({
      rel,
      package: packageNameOf(scanRoot, rel, names),
      sf: ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true, scriptKindOf(rel)),
    })
  }
  return out
}

/**
 * Index every exported type declaration of the scanned packages, keeping JSDoc.
 * The catalog resolves owner-props and inject-face shapes through this index
 * instead of a type-checker program: the declaration text with its member
 * documentation IS the teaching material a registrant needs.
 * @param scanRoot - repository root the patterns resolve against.
 * @param patterns - glob(s) selecting the TypeScript/TSX files to index.
 * @returns name → declaration, with names declared more than once dropped as ambiguous.
 */
export function indexExportedTypes(scanRoot: string, patterns: readonly string[]): Map<string, TypeDeclaration> {
  const index = new Map<string, TypeDeclaration>()
  const ambiguous = new Set<string>()
  const rels = [...new Set(globSync(patterns as string[], { cwd: scanRoot })
    .map(path => path.split(sep).join('/')))].sort()
  for (const rel of rels) {
    const abs = resolve(scanRoot, rel)
    const sf = ts.createSourceFile(abs, readFileSync(abs, 'utf8'), ts.ScriptTarget.Latest, true, scriptKindOf(rel))
    for (const statement of sf.statements) {
      if (!ts.isInterfaceDeclaration(statement) && !ts.isTypeAliasDeclaration(statement)) continue
      if (!statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue
      const name = statement.name.text
      if (index.has(name)) {
        ambiguous.add(name)
        continue
      }
      index.set(name, {
        name,
        text: declarationText(statement, sf),
        source: `${rel}:${String(lineOf(sf, statement))}`,
      })
    }
  }
  for (const name of ambiguous) index.delete(name)
  return index
}

/** The workspace package name owning a repo-relative file, memoized per package root. */
function packageNameOf(scanRoot: string, rel: string, cache: Map<string, string>): string {
  let dir = dirname(resolve(scanRoot, rel))
  while (dir.length > scanRoot.length) {
    const cached = cache.get(dir)
    if (cached !== undefined) return cached
    try {
      const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name?: unknown }
      if (typeof manifest.name === 'string') {
        cache.set(dir, manifest.name)
        return manifest.name
      }
    } catch {
      // No manifest at this level: keep walking up to the owning package root.
    }
    dir = dirname(dir)
  }
  return '(unknown package)'
}
