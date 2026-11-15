/** Runtime export collection for authored and generated module sources. */

import ts from 'typescript'
import { packageNameOf } from './verify-package-dependencies.shared.ts'

/** Export name standing for every export of a namespace import. */
export const NAMESPACE_RUNTIME_EXPORT = '*'
/** Export name standing for an import that exists only for its side effects. */
export const SIDE_EFFECT_RUNTIME_EXPORT = '(side effect)'

interface RuntimeSourceExportUse {
  readonly specifier: string
  readonly exportName: string
  readonly line: number
  readonly column: number
  readonly sourceLine: string
}

/** Collect exact runtime exports imported or re-exported by one source file. */
export function collectRuntimeSourceExportUses(path: string, source: string): RuntimeSourceExportUse[] {
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)
  const uses = new Map<string, RuntimeSourceExportUse>()
  const sourceLines = source.split(/\r?\n/u)
  const lazyRequireBindings = new Set<string>()
  const lazyRequireNamespaces = new Set<string>()
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)
      || !ts.isStringLiteralLike(statement.moduleSpecifier)
      || statement.moduleSpecifier.text !== '@deepseek-ai/dsh-lazy-require') continue
    const bindings = statement.importClause?.namedBindings
    if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
      lazyRequireNamespaces.add(bindings.name.text)
    } else if (bindings !== undefined) {
      for (const element of bindings.elements) {
        if ((element.propertyName ?? element.name).text === 'createLazyRequire') {
          lazyRequireBindings.add(element.name.text)
        }
      }
    }
  }
  const record = (specifier: string, exportName: string, locationNode: ts.Node): void => {
    const key = `${specifier}\0${exportName}`
    if (uses.has(key)) return
    const position = sourceFile.getLineAndCharacterOfPosition(locationNode.getStart(sourceFile))
    uses.set(key, {
      specifier,
      exportName,
      line: position.line + 1,
      column: position.character + 1,
      sourceLine: sourceLines[position.line]?.trim() ?? '',
    })
  }
  const add = (
    specifierNode: ts.Expression | undefined,
    exportName: string,
    locationNode: ts.Node = specifierNode ?? sourceFile,
  ): void => {
    if (specifierNode === undefined || !ts.isStringLiteralLike(specifierNode)) return
    if (packageNameOf(specifierNode.text) === undefined) return
    record(specifierNode.text, exportName, locationNode)
  }
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause
      if (clause === undefined) {
        add(node.moduleSpecifier, SIDE_EFFECT_RUNTIME_EXPORT)
      } else if (clause.phaseModifier !== ts.SyntaxKind.TypeKeyword) {
        if (clause.name !== undefined) add(node.moduleSpecifier, 'default', clause.name)
        const bindings = clause.namedBindings
        if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
          add(node.moduleSpecifier, NAMESPACE_RUNTIME_EXPORT, bindings.name)
        } else if (bindings !== undefined && bindings.elements.length === 0) {
          add(node.moduleSpecifier, SIDE_EFFECT_RUNTIME_EXPORT)
        } else if (bindings !== undefined) {
          for (const element of bindings.elements) {
            const imported = element.propertyName ?? element.name
            if (!element.isTypeOnly) add(node.moduleSpecifier, imported.text, imported)
          }
        }
      }
    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly) {
      const clause = node.exportClause
      if (clause === undefined || ts.isNamespaceExport(clause)) {
        add(node.moduleSpecifier, NAMESPACE_RUNTIME_EXPORT)
      } else if (clause.elements.length === 0) {
        add(node.moduleSpecifier, SIDE_EFFECT_RUNTIME_EXPORT)
      } else {
        for (const element of clause.elements) {
          const imported = element.propertyName ?? element.name
          if (!element.isTypeOnly) add(node.moduleSpecifier, imported.text, imported)
        }
      }
    } else if (ts.isImportEqualsDeclaration(node)
      && !node.isTypeOnly
      && ts.isExternalModuleReference(node.moduleReference)) {
      add(node.moduleReference.expression, NAMESPACE_RUNTIME_EXPORT, node.name)
    } else if (ts.isCallExpression(node)) {
      const lazyRequire = ts.isIdentifier(node.expression)
        ? lazyRequireBindings.has(node.expression.text)
        : ts.isPropertyAccessExpression(node.expression)
          && ts.isIdentifier(node.expression.expression)
          && lazyRequireNamespaces.has(node.expression.expression.text)
          && node.expression.name.text === 'createLazyRequire'
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || ts.isIdentifier(node.expression) && node.expression.text === 'require'
        || lazyRequire) add(node.arguments[0], NAMESPACE_RUNTIME_EXPORT)
    } else if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      record('react/jsx-runtime', NAMESPACE_RUNTIME_EXPORT, node)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return [...uses.values()].sort((left, right) =>
    left.specifier.localeCompare(right.specifier)
    || left.exportName.localeCompare(right.exportName)
    || left.line - right.line
    || left.column - right.column)
}
