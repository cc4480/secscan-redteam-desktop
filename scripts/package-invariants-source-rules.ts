/** Source-level rules for package-owned invariant companions. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { addViolation } from './package-invariants-model.ts'
import type { PackageInvariantOwner, PackageInvariantViolation } from './package-invariants-model.ts'

/**
 * Check one companion source file for the registration, export, and installer rules.
 * @param owner - Package being checked.
 * @param root - Repository root.
 * @param violations - Violations collected so far.
 */
export function checkSource(
  owner: PackageInvariantOwner,
  root: string,
  violations: PackageInvariantViolation[],
): void {
  const absolutePath = resolve(root, owner.sourcePath)
  const sourceText = readFileSync(absolutePath, 'utf8')
  if (sourceText.includes('@generated')) {
    addViolation(
      violations,
      owner.sourcePath,
      'invariant companions must be hand-owned and may not carry @generated markers',
    )
  }

  const sourceFile = ts.createSourceFile(
    absolutePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const constants = topLevelStringConstants(sourceFile)
  const registrations: string[] = []
  const unresolved: number[] = []
  const mismatchedInstallers: number[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isInvariantRegistration(node.expression)) {
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1
      const argument = node.arguments[0]
      const packageName = argument === undefined ? undefined : stringValue(argument, constants)
      if (packageName === undefined) unresolved.push(line)
      else registrations.push(packageName)
      const installer = node.arguments[1]
      if (installer === undefined || !ts.isIdentifier(installer) || installer.text !== 'install') {
        mismatchedInstallers.push(line)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  for (const line of unresolved) {
    addViolation(
      violations,
      owner.sourcePath,
      `line ${line}: ctx.invariants.register package name must resolve to a local string constant`,
    )
  }
  for (const line of mismatchedInstallers) {
    addViolation(
      violations,
      owner.sourcePath,
      `line ${line}: ctx.invariants.register must use the checked local install function`,
    )
  }
  if (registrations.length !== 1 || registrations[0] !== owner.packageName) {
    addViolation(
      violations,
      owner.sourcePath,
      `must register exactly its own package name ${JSON.stringify(owner.packageName)}; saw ${JSON.stringify(registrations)}`,
    )
  }
  for (const exportedName of ['name', 'inject', 'apply']) {
    if (!hasNamedExport(sourceFile, exportedName)) {
      addViolation(violations, owner.sourcePath, `must named-export ${exportedName}`)
    }
  }
  if (hasDefaultExport(sourceFile)) {
    addViolation(violations, owner.sourcePath, 'must not default-export; Loader must retain the companion namespace')
  }
  checkInstaller(owner, sourceFile, violations)
}

/**
 * Check the local install function that a companion passes to the registry.
 * @param owner - Package being checked.
 * @param sourceFile - Parsed companion source.
 * @param violations - Violations collected so far.
 */
export function checkInstaller(
  owner: PackageInvariantOwner,
  sourceFile: ts.SourceFile,
  violations: PackageInvariantViolation[],
): void {
  let initializer: ts.Expression | undefined
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)
        && declaration.name.text === 'install'
        && declaration.initializer !== undefined) {
        initializer = declaration.initializer
      }
    }
  }
  const installer = initializer === undefined ? undefined : installerFunction(initializer)
  if (installer === undefined) {
    addViolation(violations, owner.sourcePath, 'must declare a local install function for package-owned checks')
    return
  }
  if (ts.isBlock(installer.body) && installer.body.statements.length === 0) {
    addViolation(
      violations,
      owner.sourcePath,
      'empty install function is unnecessary; omit the companion and its publication wiring',
    )
    return
  }
  const reporter = installer.parameters[1]?.name
  if (reporter === undefined || !ts.isIdentifier(reporter)) {
    addViolation(violations, owner.sourcePath, 'install function must accept the bound failure reporter as its second parameter')
    return
  }
  if (!usesIdentifier(installer.body, reporter.text)) {
    addViolation(violations, owner.sourcePath, 'install function must use its bound failure reporter')
  }
}

/**
 * Report whether a subtree references a given identifier.
 * @param node - Subtree root.
 * @param name - Identifier text to find.
 * @returns whether the name occurs in the subtree.
 */
export function usesIdentifier(node: ts.Node, name: string): boolean {
  return ts.isIdentifier(node) && node.text === name
    || node.getChildren().some(child => usesIdentifier(child, name))
}

/**
 * Resolve the install function form the companion initializer uses.
 * @param initializer - Initializer expression of the `install` binding.
 * @returns the function expression, or undefined when the form is unsupported.
 */
export function installerFunction(
  initializer: ts.Expression,
): ts.ArrowFunction | ts.FunctionExpression | undefined {
  if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) return initializer
  if (ts.isCallExpression(initializer)
    && ts.isPropertyAccessExpression(initializer.expression)
    && ts.isIdentifier(initializer.expression.expression)
    && initializer.expression.expression.text === 'Object'
    && initializer.expression.name.text === 'assign') {
    const target = initializer.arguments[0]
    if (target !== undefined && (ts.isArrowFunction(target) || ts.isFunctionExpression(target))) return target
  }
  return undefined
}

/**
 * Collect the string-valued top-level constants a registration name may resolve to.
 * @param sourceFile - Parsed companion source.
 * @returns constant name to string value.
 */
export function topLevelStringConstants(sourceFile: ts.SourceFile): ReadonlyMap<string, string> {
  const constants = new Map<string, string>()
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue
      const value = stringValue(declaration.initializer, constants)
      if (value !== undefined) constants.set(declaration.name.text, value)
    }
  }
  return constants
}

/**
 * Resolve an expression to a string literal or a known constant.
 * @param node - Expression to resolve.
 * @param constants - Constants resolved so far.
 * @returns the string value, or undefined when it is not statically known.
 */
export function stringValue(node: ts.Expression, constants: ReadonlyMap<string, string>): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isIdentifier(node)) return constants.get(node.text)
  return undefined
}

/**
 * Report whether a call expression targets `ctx.invariants.register`.
 * @param expression - Call expression callee.
 * @returns whether the callee is the invariant registry method.
 */
export function isInvariantRegistration(expression: ts.LeftHandSideExpression): boolean {
  return ts.isPropertyAccessExpression(expression)
    && expression.name.text === 'register'
    && ts.isPropertyAccessExpression(expression.expression)
    && expression.expression.name.text === 'invariants'
}

/**
 * Report whether the source named-exports a variable declaration.
 * @param sourceFile - Parsed companion source.
 * @param name - Exported binding name.
 * @returns whether the binding is a named export.
 */
export function hasNamedExport(sourceFile: ts.SourceFile, name: string): boolean {
  return sourceFile.statements.some((statement) => {
    if (!ts.isVariableStatement(statement)
      || !statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) return false
    return statement.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === name)
  })
}

/**
 * Report whether the source carries a default export in any form.
 * @param sourceFile - Parsed companion source.
 * @returns whether a default export exists.
 */
export function hasDefaultExport(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some((statement) => {
    if (ts.isExportAssignment(statement)) return true
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined
    if (modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword)) return true
    if (!ts.isExportDeclaration(statement) || statement.exportClause === undefined) return false
    if (ts.isNamespaceExport(statement.exportClause)) {
      return statement.exportClause.name.text === 'default'
    }
    return statement.exportClause.elements.some(element => element.name.text === 'default')
  })
}
