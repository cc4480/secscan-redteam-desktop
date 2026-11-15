/**
 * Syntax walk that finds product copy inside one Client source file.
 *
 * Candidates come from JSX text and copy-bearing attributes, plus the data and
 * helper forms that feed them. Whether a literal is copy at all is decided by
 * the vocabulary in `verify-client-ui-i18n-copy.ts`.
 */

import ts from 'typescript'
import {
  COPY_NAME,
  COPY_SUFFIX,
  compactText,
  containsProductText,
  copyAttribute,
  localeOwner,
  looksLikeNaturalText,
  propertyName,
} from './verify-client-ui-i18n-copy.ts'
import { enclosingFunctionName, hasExplicitStringReturn } from './verify-client-ui-i18n-context.ts'

/** One hard-coded product-copy occurrence. */
export interface UiI18nViolation {
  /** One-based source column. */
  column: number
  /** Repository-relative source path. */
  file: string
  /** One-based source line. */
  line: number
  /** Why this literal is treated as product copy. */
  reason: string
  /** Compact literal text for the diagnostic. */
  text: string
}

/**
 * Find hard-coded product copy in one Client source file.
 * @param file - repository-relative path used in diagnostics.
 * @param sourceText - TypeScript or TSX source.
 * @returns violations in source order.
 */
export function findUiI18nViolations(file: string, sourceText: string): UiI18nViolation[] {
  if (localeOwner(file)) return []
  const source = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.js') ? ts.ScriptKind.JS : ts.ScriptKind.TS,
  )
  const violations = new Map<number, UiI18nViolation>()

  const report = (
    node: ts.Node,
    text: string,
    reason: string,
    naturalOnly = false,
  ): void => {
    if (
      !containsProductText(text)
      || (naturalOnly && !looksLikeNaturalText(text))
      || violations.has(node.getStart(source))
    ) return
    const position = source.getLineAndCharacterOfPosition(node.getStart(source))
    violations.set(node.getStart(source), {
      column: position.character + 1,
      file,
      line: position.line + 1,
      reason,
      text: compactText(text),
    })
  }

  const collectExpression = (
    node: ts.Expression,
    reason: string,
    naturalOnly = false,
  ): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      report(node, node.text, reason, naturalOnly)
      return
    }
    if (ts.isTemplateExpression(node)) {
      report(
        node,
        [node.head.text, ...node.templateSpans.map(span => span.literal.text)].join(''),
        reason,
        naturalOnly,
      )
      return
    }
    if (ts.isCallExpression(node)) {
      // A call result is dynamic; copy-bearing arguments are visited through their own syntax.
      return
    }
    if (
      ts.isParenthesizedExpression(node)
      || ts.isAsExpression(node)
      || ts.isSatisfiesExpression(node)
      || ts.isNonNullExpression(node)
    ) {
      collectExpression(node.expression, reason, naturalOnly)
      return
    }
    if (ts.isConditionalExpression(node)) {
      collectExpression(node.whenTrue, reason, naturalOnly)
      collectExpression(node.whenFalse, reason, naturalOnly)
      return
    }
    if (ts.isBinaryExpression(node)) {
      if (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
        collectExpression(node.right, reason, naturalOnly)
      } else if (
        node.operatorToken.kind === ts.SyntaxKind.PlusToken
        || node.operatorToken.kind === ts.SyntaxKind.BarBarToken
        || node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      ) {
        collectExpression(node.left, reason, naturalOnly)
        collectExpression(node.right, reason, naturalOnly)
      }
      return
    }
    if (ts.isArrayLiteralExpression(node)) {
      for (const element of node.elements) {
        if (ts.isExpression(element)) collectExpression(element, reason, naturalOnly)
      }
      return
    }
    if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        if (ts.isPropertyAssignment(property)) {
          const name = propertyName(property.name)
          const propertyOwnsCopy = name !== undefined
            && (COPY_NAME.test(name) || COPY_SUFFIX.test(name))
          collectExpression(property.initializer, reason, naturalOnly || !propertyOwnsCopy)
        }
      }
    }
  }

  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) report(node, node.text, 'JSX text')

    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(source)
      if (copyAttribute(name) && node.initializer !== undefined) {
        if (ts.isStringLiteral(node.initializer)) report(node.initializer, node.initializer.text, `${name} attribute`)
        else if (ts.isJsxExpression(node.initializer) && node.initializer.expression !== undefined) {
          collectExpression(node.initializer.expression, `${name} attribute`)
        }
      }
    }

    if (
      ts.isJsxExpression(node)
      && node.expression !== undefined
      && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
    ) collectExpression(node.expression, 'JSX child')

    if ((file.endsWith('.tsx') || file.startsWith('apps/desktop/')) && ts.isPropertyAssignment(node)) {
      const name = propertyName(node.name)
      if (name !== undefined && (COPY_NAME.test(name) || COPY_SUFFIX.test(name))) {
        collectExpression(node.initializer, `${name} property`)
      }
    }

    if (file.startsWith('apps/desktop/') && ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isPropertyAccessExpression(node.left)
      && (node.left.name.text === 'textContent' || node.left.name.text === 'innerText')) {
      collectExpression(node.right, `${node.left.name.text} assignment`)
    }

    if (file.startsWith('apps/desktop/') && ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && (node.expression.name.text === 'setTitle' || node.expression.name.text === 'prompt')) {
      const copy = node.arguments[0]
      if (copy !== undefined) collectExpression(copy, `${node.expression.name.text} argument`)
    }

    if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
      const name = propertyName(node.name)
      if (name !== undefined && (COPY_NAME.test(name) || COPY_SUFFIX.test(name))) {
        collectExpression(node.initializer, `${name} value`)
      }
    }

    if (ts.isBindingElement(node) && node.initializer !== undefined) {
      const name = propertyName(node.name)
      if (name !== undefined && (COPY_NAME.test(name) || COPY_SUFFIX.test(name))) {
        collectExpression(node.initializer, `${name} default value`)
      }
    }

    if (ts.isReturnStatement(node) && node.expression !== undefined) {
      const name = enclosingFunctionName(node)
      if (name !== undefined && (COPY_NAME.test(name) || COPY_SUFFIX.test(name))) {
        collectExpression(node.expression, `${name} return value`)
      } else if (file.endsWith('.tsx') && hasExplicitStringReturn(node)) {
        collectExpression(node.expression, 'string return value', true)
      }
    }

    ts.forEachChild(node, visit)
  }
  visit(source)
  return [...violations.values()].sort((left, right) => left.line - right.line || left.column - right.column)
}
