/** Compiler-program construction and reachable-declaration validation for persistence schema extraction. */

import { readFileSync } from 'node:fs'
import { dirname, extname, relative, resolve } from 'node:path'
import ts from 'typescript'
import { PersistenceSchemaError, diagnosticText, isNamedTypeDeclaration, slash, trackedSource } from './persistence-schema-shared.ts'

/**
 * Collect the host program source files that hold persisted schema declarations.
 * @param root - repository root.
 * @param configPath - tsconfig to read, followed through project references.
 * @param seen - configs already read, to stop reference cycles.
 * @returns absolute tracked source paths.
 */
export function hostSourceFiles(root: string, configPath: string, seen = new Set<string>()): string[] {
  configPath = resolve(configPath)
  if (seen.has(configPath)) return []
  seen.add(configPath)
  const read = ts.readConfigFile(configPath, file => readFileSync(file, 'utf8'))
  if (read.error !== undefined) throw new PersistenceSchemaError(diagnosticText(read.error))
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(configPath), undefined, configPath)
  const errors = parsed.errors.filter(error => error.code !== 18003)
  if (errors.length > 0) throw new PersistenceSchemaError(errors.map(diagnosticText).join('\n'))
  return [
    ...parsed.fileNames.filter(file => /^packages\/[^/]+\/[^/]+\/src\//.test(slash(relative(root, file)))),
    ...(parsed.projectReferences ?? []).flatMap(reference =>
      hostSourceFiles(root, extname(reference.path) === '.json' ? reference.path : resolve(reference.path, 'tsconfig.json'), seen)),
  ]
}

/**
 * Visit the reachable declarations and reject compiler errors inside them.
 * @param program - compiled program holding the roots.
 * @param root - repository root.
 * @param roots - declarations to walk from.
 * @returns the tracked type declarations keyed by checker type.
 */
export function validateReachableDeclarations(
  program: ts.Program,
  root: string,
  roots: readonly ts.Node[],
): ReadonlyMap<ts.Type, readonly ts.Node[]> {
  const checker = program.getTypeChecker()
  const visited = new Set<ts.Node>()
  const declarations = new Map<ts.SourceFile, ts.Node[]>()
  const definitions = new Map<ts.Type, ts.Node[]>()
  const visit = (node: ts.Node): void => {
    if (visited.has(node)) return
    visited.add(node)
    const file = node.getSourceFile()
    if (trackedSource(slash(relative(root, file.fileName)))) {
      const scopes = declarations.get(file) ?? []
      scopes.push(node)
      declarations.set(file, scopes)
      if (isNamedTypeDeclaration(node) || ts.isTypeLiteralNode(node)) {
        // Primitive aliases share checker types with unaliased properties.
        const type = checker.getTypeAtLocation(node)
        const entries = definitions.get(type) ?? []
        entries.push(node)
        definitions.set(type, entries)
      }
    }
    const target = ts.isTypeReferenceNode(node) ? node.typeName
      : ts.isExpressionWithTypeArguments(node) ? node.expression
        : ts.isTypeQueryNode(node) ? node.exprName
          : ts.isImportTypeNode(node) ? node.qualifier
            : undefined
    if (target !== undefined) {
      let symbol = checker.getSymbolAtLocation(target)
      if (symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias)) symbol = checker.getAliasedSymbol(symbol)
      for (const declaration of symbol?.declarations ?? []) {
        if (trackedSource(slash(relative(root, declaration.getSourceFile().fileName)))) visit(declaration)
      }
    }
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) return
    ts.forEachChild(node, visit)
  }
  for (const root of roots) visit(root)
  const errors = [...declarations].flatMap(([file, scopes]) => program.getSemanticDiagnostics(file)
    .filter((error) => {
      const start = error.start
      return start !== undefined && scopes.some(scope => start >= scope.getStart() && start < scope.end)
    }))
  if (errors.length > 0) throw new PersistenceSchemaError(errors.map(diagnosticText).join('\n'))
  return definitions
}
