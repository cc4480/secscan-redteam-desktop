/**
 * Module resolution identity: which package and subpath one reference, import binding, or external file belongs to.
 *
 * @module @deepseek-ai/dsh-typert-generator/analyzer-module
 */

import ts from 'typescript'
import { TypertAnalysisError } from './analyzer-types.ts'
import type { ImportBinding, ModuleIdentity, ReferenceSite } from './analyzer-types.ts'
import { slash } from './analyzer-diagnostic.ts'

/** The import specifier one reference reaches through a local binding. */
export function moduleSpecifierOf(node: ReferenceSite): string | undefined {
  if (ts.isImportTypeNode(node)) {
    const argument = node.argument as ts.LiteralTypeNode & { readonly literal: ts.StringLiteral }
    return argument.literal.text
  }
  const symbol = ts.isTypeReferenceNode(node)
    ? node.typeName
    : node.expression
  const sourceFile = node.getSourceFile()
  const first = ts.isIdentifier(symbol) ? symbol.text : symbol.getFirstToken(sourceFile)?.getText(sourceFile)
  return first === undefined ? undefined : importBindingOf(sourceFile, first)?.specifier
}

/** The name the defining module exports one reference under. */
export function authoredExportName(node: ReferenceSite, moduleSpecifier: string): string {
  if (ts.isImportTypeNode(node)) return (node.qualifier as ts.EntityName).getText().split('.')[0] as string

  const referenced = ts.isTypeReferenceNode(node)
    ? node.typeName.getText().split('.')
    : node.expression.getText().split('.')
  const localName = referenced[0] as string
  const binding = importBindingOf(node.getSourceFile(), localName)
  /* v8 ignore next -- moduleSpecifierOf returns only the import inspected by importBindingOf. */
  if (binding === undefined) throw new TypertAnalysisError(`typert: cannot recover export name for ${localName} from ${moduleSpecifier}`)
  return binding.name ?? (referenced[1] as string)
}

/** The import binding one local name resolves to in one source file. */
export function importBindingOf(sourceFile: ts.SourceFile, localName: string): ImportBinding | undefined {
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause === undefined
      || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const specifier = statement.moduleSpecifier.text
    if (statement.importClause.name?.text === localName) return { specifier, name: 'default' }
    const bindings = statement.importClause.namedBindings
    if (bindings === undefined) continue
    if (ts.isNamespaceImport(bindings)) {
      if (bindings.name.text === localName) return { specifier }
      continue
    }
    const element = bindings.elements.find(candidate => candidate.name.text === localName)
    if (element !== undefined) return { specifier, name: element.propertyName?.text ?? element.name.text }
  }
  return undefined
}

/** The import-attributes text of one `import(...)` type node. */
export function importTypeAttributesText(node: ts.ImportTypeNode): string {
  const sourceFile = node.getSourceFile()
  const children = node.getChildren(sourceFile)
  const comma = children.find(child => child.kind === ts.SyntaxKind.CommaToken) as ts.Node
  const close = children.find(child => child.kind === ts.SyntaxKind.CloseParenToken) as ts.Node
  return sourceFile.text.slice(comma.end, close.pos).trim()
}

/** The package and subpath one bare module specifier names. */
export function moduleIdentity(specifier: string): ModuleIdentity | undefined {
  if (specifier.startsWith('.') || specifier.startsWith('/')) return undefined
  const parts = specifier.split('/')
  const packageLength = specifier.startsWith('@') ? 2 : 1
  const packageName = parts.slice(0, packageLength).join('/')
  const rest = parts.slice(packageLength).join('/')
  return {
    package: packageName,
    subpath: rest.length === 0 ? '.' : `./${rest}`,
  }
}

/** The package one external file belongs to, when it sits under `node_modules`. */
export function externalModuleIdentityForFile(file: string): ModuleIdentity | undefined {
  const normalized = slash(file)
  const marker = '/node_modules/'
  const index = normalized.lastIndexOf(marker)
  if (index < 0) return undefined
  const parts = normalized.slice(index + marker.length).split('/')
  const packageLength = (parts[0] as string).startsWith('@') ? 2 : 1
  const packageName = parts.slice(0, packageLength).join('/')
  return { package: packageName, subpath: '.' }
}

/** Whether one file is a TypeScript bundled default library. */
export function isStandardLibraryFile(file: string): boolean {
  const base = file.replaceAll('\\', '/')
  return /\/typescript\/lib\/lib\.[^/]+\.d\.ts$/.test(base)
}

