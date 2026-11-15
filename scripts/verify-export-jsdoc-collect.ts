/**
 * Entry point for the exported-API JSDoc gate: build the program over every
 * non-vendored package source file and collect the violations the scope walk
 * finds in its exports.
 */

import { globSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import ts from 'typescript'
import { loadCompilerOptions, restrictedPublicNames } from './verify-export-jsdoc-program.ts'
import { checkScope } from './verify-export-jsdoc-scope.ts'

const root = resolve(import.meta.dirname, '..')

/**
 * Walk every non-vendored package source file and collect JSDoc-completeness
 * violations for its module-level exports. Returns findings instead of
 * throwing so tests assert on the list; the CLI entry turns a non-empty list
 * into exit 1.
 * @param scanRoot - the repo root to scan; tests pass a fixture dir.
 * @returns every violation, in file order, one human-readable line each.
 */
export function collectExportJsdocViolations(scanRoot: string = root): string[] {
  const violations: string[] = []
  const rels = globSync('packages/*/*/src/**/*.ts', { cwd: scanRoot })
    .map(path => path.split(sep).join('/'))
    .sort()
  const program = ts.createProgram(rels.map(rel => resolve(scanRoot, rel)), loadCompilerOptions(scanRoot))
  const checker = program.getTypeChecker()
  const { restrictedPackages, namesByFile } = restrictedPublicNames(scanRoot, rels, program, checker)
  for (const rel of rels) {
    const sf = program.getSourceFile(resolve(scanRoot, rel))
    if (!sf) continue // program root files always resolve; guard for narrowing
    // A script-style declaration file (no imports/exports) is one big ambient
    // scope; a module-style .d.ts still honors explicit export modifiers.
    const packageDir = rel.split('/').slice(0, 3).join('/')
    const allowedNames = restrictedPackages.has(packageDir) ? namesByFile.get(rel) ?? new Set<string>() : undefined
    checkScope(
      sf.statements,
      '',
      { rel, sf, text: sf.text, checker, violations },
      sf.isDeclarationFile && !ts.isExternalModule(sf),
      allowedNames,
    )
  }
  return violations
}
