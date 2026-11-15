/**
 * Member-level naming and shape: how one member name, visibility, modifier, and literal type reach the model.
 *
 * @module @deepseek-ai/dsh-typert-generator/analyzer-member
 */

import ts from 'typescript'
import { TypertAnalysisError } from './analyzer-types.ts'
import type {
  KeywordTypeName,
  MemberModel,
  MemberVisibility,
  TypeNodeModel,
} from './model.ts'

/** One member name as the model records it. */
export function memberName(name: ts.PropertyName | ts.BindingName): string {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name)
    || ts.isNumericLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text
  if (ts.isComputedPropertyName(name)) return `[${name.expression.getText()}]`
  return name.getText()
}

/** The text of one string literal or no-substitution template, when the node is one. */
export function stringLiteralValue(node: ts.Node | undefined): string | undefined {
  return node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined
}

/** Whether one path segment is a legal Typert Remote namespace segment. */
export function isRemoteSegment(value: string): boolean {
  // Generation bootstraps workspace artifacts before dsh-typert-protocol is built,
  // so this extraction-only copy must mirror isTypertRemoteSegment().
  return value !== '.' && value !== '..' && /^[A-Za-z0-9_$.-]+$/.test(value)
}

/** The name one expression refers to, for the expressions Typert reads. */
export function expressionName(node: ts.Expression): string | undefined {
  if (ts.isIdentifier(node)) return node.text
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  return undefined
}

/** The import specifier that reaches one export subpath of a package. */
export function packageExportSpecifier(packageName: string, subpath: string): string {
  return subpath === '.' ? packageName : `${packageName}${subpath.slice(1)}`
}

/** The declared visibility of one member. */
export function visibilityOf(node: ts.Node): MemberVisibility {
  if ('name' in node && node.name !== undefined && ts.isPrivateIdentifier(node.name as ts.Node)) return 'private'
  if (hasModifier(node, ts.SyntaxKind.PrivateKeyword)) return 'private'
  if (hasModifier(node, ts.SyntaxKind.ProtectedKeyword)) return 'protected'
  return 'public'
}

/** Whether one node carries the given modifier. */
export function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return (ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined)?.some(modifier => modifier.kind === kind) ?? false
}

/** Whether one member belongs in the public surface projection. */
export function exposableMember(member: MemberModel): boolean {
  return member.visibility === 'public' && !member.static
}

/** The model name of one keyword type syntax. */
export function keywordName(kind: ts.SyntaxKind): KeywordTypeName | undefined {
  switch (kind) {
    case ts.SyntaxKind.AnyKeyword: return 'any'
    case ts.SyntaxKind.BigIntKeyword: return 'bigint'
    case ts.SyntaxKind.BooleanKeyword: return 'boolean'
    case ts.SyntaxKind.NeverKeyword: return 'never'
    case ts.SyntaxKind.NumberKeyword: return 'number'
    case ts.SyntaxKind.ObjectKeyword: return 'object'
    case ts.SyntaxKind.StringKeyword: return 'string'
    case ts.SyntaxKind.SymbolKeyword: return 'symbol'
    case ts.SyntaxKind.UndefinedKeyword: return 'undefined'
    case ts.SyntaxKind.UnknownKeyword: return 'unknown'
    case ts.SyntaxKind.VoidKeyword: return 'void'
    default: return undefined
  }
}

/** Project one literal type node into the model's literal node. */
export function literalModel(node: ts.LiteralTypeNode): Omit<Extract<TypeNodeModel, { kind: 'literal' }>, 'id'> {
  const literal = node.literal
  if (ts.isStringLiteral(literal)) return { kind: 'literal', value: literal.text, text: literal.getText() }
  if (ts.isNoSubstitutionTemplateLiteral(literal)) {
    return { kind: 'literal', value: literal.text, text: literal.getText() }
  }
  if (ts.isNumericLiteral(literal)) return { kind: 'literal', value: Number(literal.text), text: literal.getText() }
  if (ts.isBigIntLiteral(literal)) return { kind: 'literal', value: BigInt(literal.text.slice(0, -1)), text: literal.getText() }
  if (literal.kind === ts.SyntaxKind.TrueKeyword) return { kind: 'literal', value: true, text: 'true' }
  if (literal.kind === ts.SyntaxKind.FalseKeyword) return { kind: 'literal', value: false, text: 'false' }
  if (literal.kind === ts.SyntaxKind.NullKeyword) return { kind: 'literal', value: null, text: 'null' }
  /* v8 ignore else -- all remaining LiteralTypeNode syntax is a signed numeric or bigint literal. */
  if (ts.isPrefixUnaryExpression(literal)
    && (ts.isNumericLiteral(literal.operand) || ts.isBigIntLiteral(literal.operand))) {
    return {
      kind: 'literal',
      value: ts.isBigIntLiteral(literal.operand)
        ? BigInt(literal.getText().slice(0, -1))
        : Number(literal.getText()),
      text: literal.getText(),
    }
  }
  /* v8 ignore next -- TypeScript's LiteralTypeNode grammar is exhausted above; this contains future compiler syntax. */
  throw new TypertAnalysisError(`typert: unsupported literal type ${literal.getText()}`)
}

/** The variance one readonly, plus, or minus modifier token declares. */
export function modifierMode(token: ts.ReadonlyKeyword | ts.PlusToken | ts.MinusToken | ts.QuestionToken | undefined):
  'add' | 'remove' | 'preserve' {
  if (token?.kind === ts.SyntaxKind.PlusToken) return 'add'
  if (token?.kind === ts.SyntaxKind.MinusToken) return 'remove'
  return token === undefined ? 'preserve' : 'add'
}

/** The source position where one missing annotation would be inserted. */
export function annotationPosition(
  node: ts.Node,
  purpose: 'property' | 'parameter' | 'return',
): number {
  if (purpose === 'return') return (node as ts.SignatureDeclarationBase).parameters.end + 1
  return (node as ts.ParameterDeclaration | ts.PropertyDeclaration | ts.PropertySignature).name.end
}

