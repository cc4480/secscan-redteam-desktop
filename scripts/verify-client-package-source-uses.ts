/** Syntax-aware collection of the modules one production source file requests. */

import ts from 'typescript'

/**
 * Collect bare packages referenced by one production source file.
 * @param path - File path used to select TypeScript's parser mode.
 * @param source - Source text to inspect.
 * @returns Bare package names referenced by imports, declarations, or JSX.
 */
export function collectSourcePackageUses(path: string, source: string): Set<string> {
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)
  return collectSourceFileUses(sourceFile, false, 'package')
}

/**
 * Collect bare packages whose values one production source file reaches at runtime.
 * @param path - File path used to select TypeScript's parser mode.
 * @param source - Source text to inspect.
 * @returns Bare package names retained by runtime imports, exports, requires, or JSX.
 */
export function collectRuntimeSourcePackageUses(path: string, source: string): Set<string> {
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)
  return collectSourceFileUses(sourceFile, true, 'package')
}

/**
 * Collect exact bare specifiers retained by one production source file.
 * @param path - File path used to select TypeScript's parser mode.
 * @param source - Source text to inspect.
 * @returns Exact specifiers retained by runtime imports, exports, requires, or JSX.
 */
export function collectRuntimeSourceSpecifiers(path: string, source: string): Set<string> {
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)
  return collectSourceFileUses(sourceFile, true, 'specifier')
}

/**
 * Collect relative module specifiers used to follow one source entry's local closure.
 * @param path - File path used to select TypeScript's parser mode.
 * @param source - Source text to inspect.
 * @returns Relative imports, exports, requires, and import types.
 */
export function collectLocalSourceSpecifiers(path: string, source: string): Set<string> {
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)
  return collectSourceFileUses(sourceFile, false, 'local')
}

/**
 * Collect local module specifiers retained by one production source file.
 * @param path - File path used to select TypeScript's parser mode.
 * @param source - Source text to inspect.
 * @param includeRootRelative - Include absolute paths, such as Vite's Web-root imports.
 * @returns Local imports, exports, and requires that survive compilation.
 */
export function collectRuntimeLocalSourceSpecifiers(path: string, source: string, includeRootRelative = false): Set<string> {
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)
  return collectSourceFileUses(sourceFile, true, 'local', includeRootRelative)
}

/**
 * Collect the modules one parsed source file requests.
 * @param sourceFile - Parsed production source file.
 * @param runtimeOnly - Skip declarations that erased type-only requests.
 * @param key - Whether to collect bare packages, exact specifiers, or local paths.
 * @param includeRootRelative - Include absolute paths, such as Vite's Web-root imports.
 * @returns The requested modules selected by `key`.
 */
export function collectSourceFileUses(
  sourceFile: ts.SourceFile,
  runtimeOnly: boolean,
  key: 'local' | 'package' | 'specifier',
  includeRootRelative = false,
): Set<string> {
  const uses = new Set<string>()

  const add = (specifier: ts.Expression | undefined): void => {
    if (specifier === undefined || !ts.isStringLiteralLike(specifier)) return
    if (key === 'local') {
      if (specifier.text.startsWith('.') || includeRootRelative && specifier.text.startsWith('/')) uses.add(specifier.text)
      return
    }
    if (!isBareSpecifier(specifier.text)) return
    uses.add(key === 'package' ? packageNameOf(specifier.text) : specifier.text)
  }
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      if (!runtimeOnly || importCarriesRuntimeValue(node)) add(node.moduleSpecifier)
    } else if (ts.isExportDeclaration(node)) {
      if (!runtimeOnly || exportCarriesRuntimeValue(node)) add(node.moduleSpecifier)
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      if (!runtimeOnly || !node.isTypeOnly) add(node.moduleReference.expression)
    } else if (!runtimeOnly && ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node.argument.literal)
    } else if (ts.isCallExpression(node)
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
      add(node.arguments[0])
    } else if (!runtimeOnly && key !== 'local' && ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name)) {
      add(node.name)
    } else if (key !== 'local'
      && (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node))) {
      uses.add('react')
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return uses
}

/**
 * Return the package that owns one bare specifier.
 * @param specifier - Bare module specifier, with or without a subpath.
 * @returns The package name, scope included.
 */
export function packageNameOf(specifier: string): string {
  const segments = specifier.split('/')
  return segments.slice(0, specifier.startsWith('@') ? 2 : 1).join('/')
}

function importCarriesRuntimeValue(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause
  if (clause === undefined) return true
  if (clause.phaseModifier === ts.SyntaxKind.TypeKeyword) return false
  const bindings = clause.namedBindings
  return clause.name !== undefined
    || bindings === undefined
    || ts.isNamespaceImport(bindings)
    || bindings.elements.length === 0
    || bindings.elements.some(element => !element.isTypeOnly)
}

function exportCarriesRuntimeValue(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return false
  const clause = node.exportClause
  if (clause === undefined || ts.isNamespaceExport(clause)) return true
  return clause.elements.length === 0 || clause.elements.some(element => !element.isTypeOnly)
}

function isBareSpecifier(specifier: string): boolean {
  return !specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('#')
}
