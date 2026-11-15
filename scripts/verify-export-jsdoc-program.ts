/**
 * Program setup for the exported-API JSDoc gate: the compiler options the walk
 * builds its program from, and the narrowing of packages whose `exports` map
 * withholds `src/*` to the names their published entries actually expose.
 */

import { existsSync, readFileSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import ts from 'typescript'
import { declarationName } from './verify-export-jsdoc-walk.ts'

/**
 * Flatten a package `exports` target into the relative paths it names.
 * @param value - an `exports` entry: a string, a conditions object, or a nested map.
 * @returns every relative target path the entry names, in object-key order.
 */
function exportedTargets(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (!value || typeof value !== 'object') return []
  return Object.values(value).flatMap(exportedTargets)
}

/**
 * Map a published entry target onto the source file it is built from.
 * @param target - one `exports` target path.
 * @returns the package-relative `src/*.ts` path, or undefined for a non-source target.
 */
function sourceEntry(target: string): string | undefined {
  if (target.startsWith('./lib/types/') && target.endsWith('.d.ts')) {
    return `src/${target.slice('./lib/types/'.length, -'.d.ts'.length)}.ts`
  }
  if (target.startsWith('./lib/') && target.endsWith('.js')) {
    return `src/${target.slice('./lib/'.length, -'.js'.length)}.ts`
  }
  return undefined
}

/**
 * Resolve the declarations reachable through packages that do not export src/*.
 * @param scanRoot - the root being scanned.
 * @param rels - the scanned package source files, `/`-separated and package-qualified.
 * @param program - the program the walk created.
 * @param checker - the program's type checker.
 * @returns the narrowed package directories and, per source file, the names their entries export.
 */
export function restrictedPublicNames(
  scanRoot: string,
  rels: readonly string[],
  program: ts.Program,
  checker: ts.TypeChecker,
): { restrictedPackages: Set<string>; namesByFile: Map<string, Set<string>> } {
  const restrictedPackages = new Set<string>()
  const namesByFile = new Map<string, Set<string>>()
  const packages = new Set(rels.map(rel => rel.split('/').slice(0, 3).join('/')))
  for (const packageDir of packages) {
    const manifestPath = resolve(scanRoot, packageDir, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { exports?: Record<string, unknown> }
    if (!manifest.exports || manifest.exports['./src/*'] !== undefined) continue
    restrictedPackages.add(packageDir)
    const entries = new Set(Object.values(manifest.exports).flatMap(exportedTargets).flatMap((target) => {
      const entry = sourceEntry(target)
      return entry ? [`${packageDir}/${entry}`] : []
    }))
    for (const entry of entries) {
      const source = program.getSourceFile(resolve(scanRoot, entry))
      const moduleSymbol = source && checker.getSymbolAtLocation(source)
      if (!source || !moduleSymbol) continue
      for (const exported of checker.getExportsOfModule(moduleSymbol)) {
        const target = (exported.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(exported) : exported
        for (const declaration of target.declarations ?? []) {
          const name = declarationName(declaration)
          const file = declaration.getSourceFile().fileName
          const rel = relative(scanRoot, file).split(sep).join('/')
          if (!name || !rel.startsWith(`${packageDir}/src/`)) continue
          namesByFile.set(rel, new Set([...(namesByFile.get(rel) ?? []), name]))
        }
      }
    }
  }
  return { restrictedPackages, namesByFile }
}

/**
 * Compiler options for the walk's program.
 *
 * @param scanRoot - the root being scanned.
 * @returns compiler options for ts.createProgram.
 */
export function loadCompilerOptions(scanRoot: string): ts.CompilerOptions {
  const cfgPath = resolve(scanRoot, 'tsconfig.base.json')
  if (!existsSync(cfgPath)) return { skipLibCheck: true, noLib: true, types: [] }
  const cfg = ts.readConfigFile(cfgPath, ts.sys.readFile.bind(ts.sys)) as { config?: unknown }
  const parsed = ts.parseJsonConfigFileContent(cfg.config ?? {}, ts.sys, scanRoot)
  return {
    ...parsed.options,
    noEmit: true,
    composite: false,
    declaration: false,
    declarationMap: false,
    sourceMap: false,
    incremental: false,
  }
}
