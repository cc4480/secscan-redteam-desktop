/**
 * Which function a literal sits in, and what that function declares it returns.
 *
 * The copy rules treat a returned or defaulted literal differently by the name
 * and declared type of the function that owns it.
 */

import ts from 'typescript'
import { propertyName } from './verify-client-ui-i18n-copy.ts'

/**
 * Find the nearest enclosing function that carries a usable name.
 * @param node - Node whose ancestors are searched.
 * @returns The declared name, the variable holding an arrow function, or undefined.
 */
export function enclosingFunctionName(node: ts.Node): string | undefined {
  let current = node.parent
  while (!ts.isSourceFile(current)) {
    if (ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current)) {
      return current.name === undefined ? undefined : propertyName(current.name)
    }
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
      const parent = current.parent
      return ts.isVariableDeclaration(parent) ? propertyName(parent.name) : undefined
    }
    current = current.parent
  }
  return undefined
}

/**
 * Whether the nearest enclosing function declares a `string` return type.
 * @param node - Node whose ancestors are searched.
 * @returns True when that function's written return type is `string`.
 */
export function hasExplicitStringReturn(node: ts.Node): boolean {
  let current = node.parent
  while (!ts.isSourceFile(current)) {
    if (
      ts.isFunctionDeclaration(current)
      || ts.isMethodDeclaration(current)
      || ts.isArrowFunction(current)
      || ts.isFunctionExpression(current)
    ) return current.type?.kind === ts.SyntaxKind.StringKeyword
    current = current.parent
  }
  return false
}
