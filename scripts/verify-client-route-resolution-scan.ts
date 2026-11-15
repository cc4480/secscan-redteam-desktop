/** Syntax-tree scan: which app-owned routes a source file binds to one mount. */

import ts from 'typescript'
import {
  ABSOLUTE_ROUTE,
  HOST_ROUTE_KEY,
  LOCATION_EXPRESSION,
  REFERENCE_FIELDS,
  RELATIVE_APP_ROUTE,
  REQUEST_CONSTRUCTORS,
  REQUEST_PROPERTIES,
  ROOT_ABSOLUTE_ROUTE,
  type RouteGateFace,
  type RouteResolutionRule,
  type RouteResolutionViolation,
} from './verify-client-route-resolution-rules.ts'

/** Source text of a location expression, without whitespace. */
function locationText(node: ts.Expression): string | undefined {
  const text = node.getText().replace(/\s+/g, '')
  return LOCATION_EXPRESSION.test(text) ? text : undefined
}

/** Whether an expression rebuilds a base from the page location anywhere inside it. */
function readsLocation(node: ts.Node): boolean {
  if (ts.isExpression(node) && locationText(node) !== undefined) return true
  return node.forEachChild(readsLocation) === true
}

/** Host route keys an expression references without stripping their leading slash. */
function unstrippedHostRouteKeys(node: ts.Node): ts.Identifier[] {
  if (ts.isIdentifier(node)) {
    if (!HOST_ROUTE_KEY.test(node.text)) return []
    const derived = ts.isPropertyAccessExpression(node.parent) && node.parent.name.text === 'slice'
    return derived ? [] : [node]
  }
  const keys: ts.Identifier[] = []
  node.forEachChild((child) => { keys.push(...unstrippedHostRouteKeys(child)) })
  return keys
}

/** Callee name of a call or construction, for constructors and `fetch`-shaped carriers. */
function calleeName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text
  return ts.isPropertyAccessExpression(expression) ? expression.name.text : undefined
}

/**
 * The request target one node carries, when it addresses a resource.
 * @param node - any node visited in the tree.
 * @returns the target expression, or undefined when the node is not a target.
 */
function requestTargetOf(node: ts.Node): ts.Expression | undefined {
  if (ts.isCallExpression(node)) {
    const name = calleeName(node.expression)
    if ((name !== undefined && /fetch(er)?$/iu.test(name)) || node.expression.kind === ts.SyntaxKind.ImportKeyword) return node.arguments[0]
    return undefined
  }
  if (ts.isNewExpression(node)) {
    const name = calleeName(node.expression)
    return name !== undefined && REQUEST_CONSTRUCTORS[name] === true ? node.arguments?.[0] : undefined
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    && ts.isPropertyAccessExpression(node.left) && REQUEST_PROPERTIES[node.left.name.text] === true) {
    return node.right
  }
  if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && REQUEST_PROPERTIES[node.name.text] === true) {
    const { initializer } = node
    if (initializer === undefined) return undefined
    return ts.isJsxExpression(initializer) ? initializer.expression : initializer
  }
  return undefined
}

/** One literal fragment of a composed value, with the node that carries it. */
interface LiteralFragment { node: ts.Node; text: string }

/**
 * Literal fragments of a value composed of literals, `+` concatenation,
 * templates, and conditionals. Template fragments are the spans between
 * substitutions, so an interpolated prefix (`${origin}/api/x`) is visible.
 * @param node - the expression to decompose.
 * @returns fragments in source order.
 */
function literalFragments(node: ts.Expression): LiteralFragment[] {
  if (ts.isParenthesizedExpression(node)) return literalFragments(node.expression)
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return [...literalFragments(node.left), ...literalFragments(node.right)]
  }
  if (ts.isConditionalExpression(node)) {
    return [...literalFragments(node.whenTrue), ...literalFragments(node.whenFalse)]
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [{ node, text: node.text }]
  if (ts.isTemplateExpression(node)) {
    // Every fragment reports the template itself: an interpolated prefix makes
    // the offending span start mid-expression, and one template is one route.
    return [
      { node, text: node.head.text },
      ...node.templateSpans.map(span => ({ node, text: span.literal.text })),
    ]
  }
  return []
}

/**
 * Find app-owned routes that bind one source file to one mount.
 * @param file - repository-relative path used in diagnostics.
 * @param sourceText - TypeScript or TSX source.
 * @param face - `browser` for request targets, `reference-producer` for the
 * fields a static host emits into the browser.
 * @returns violations in source order.
 */
export function findRouteResolutionViolations(
  file: string,
  sourceText: string,
  face: RouteGateFace = 'browser',
): RouteResolutionViolation[] {
  const source = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const violations = new Map<number, RouteResolutionViolation>()

  const report = (node: ts.Node, rule: RouteResolutionRule): void => {
    const start = node.getStart(source)
    if (violations.has(start)) return
    const { character, line } = source.getLineAndCharacterOfPosition(start)
    violations.set(start, { column: character + 1, file, line: line + 1, pattern: node.getText(source), rule })
  }

  /** A request target's own literals must be document-relative. */
  const checkTarget = (target: ts.Expression): void => {
    for (const fragment of literalFragments(target)) {
      if (ROOT_ABSOLUTE_ROUTE.test(fragment.text) || ABSOLUTE_ROUTE.test(fragment.text)) {
        report(fragment.node, 'request-target')
      }
    }
    // A shared route key used as-is: the browser half strips the leading slash.
    for (const key of unstrippedHostRouteKeys(target)) report(key, 'host-route-key')
  }

  /** A relative app route belongs to the document base, not to a rebuilt origin. */
  const checkUrlBase = (node: ts.NewExpression): void => {
    const [first, second] = node.arguments ?? []
    if (first === undefined || second === undefined || !readsLocation(second)) return
    const literal = literalFragments(first)
    if (literal.some(fragment => RELATIVE_APP_ROUTE.test(fragment.text))) report(first, 'location-base')
  }

  /** A field the browser resolves against its document carries a reference. */
  const checkReferenceField = (value: ts.Expression): void => {
    for (const fragment of literalFragments(value)) {
      if (ROOT_ABSOLUTE_ROUTE.test(fragment.text) || ABSOLUTE_ROUTE.test(fragment.text)) {
        report(fragment.node, 'reference-producer')
      }
    }
  }

  const visit = (node: ts.Node): void => {
    if (face === 'browser') {
      const target = requestTargetOf(node)
      if (target !== undefined) checkTarget(target)
      if (ts.isNewExpression(node) && calleeName(node.expression) === 'URL') checkUrlBase(node)
    } else if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)
      && REFERENCE_FIELDS[node.name.text] === true && ts.isExpression(node.initializer)) {
      checkReferenceField(node.initializer)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)

  return [...violations.values()].sort((left, right) => left.line - right.line || left.column - right.column)
}
