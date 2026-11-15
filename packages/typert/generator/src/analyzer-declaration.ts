/**
 * Declaration and documentation projection: the text a declaration emits, its shape without bodies or private members, and its JSDoc.
 *
 * @module @deepseek-ai/dsh-typert-generator/analyzer-declaration
 */

import ts from 'typescript'
import { EMPTY_DOCUMENTATION } from './analyzer-types.ts'
import type { DocumentationModel, JsDocTagModel } from './model.ts'

/** The declaration whose text and JSDoc represent one symbol. */
export function preferredDeclaration(symbol: ts.Symbol): ts.Declaration | undefined {
  return symbol.declarations?.find(isTypeDeclaration)
    ?? symbol.valueDeclaration
    ?? symbol.declarations?.[0]
}

/** The parent node of one node, when the compiler attached one. */
export function optionalParent(node: ts.Node): ts.Node | undefined {
  return (node as ts.Node & { readonly parent?: ts.Node }).parent
}

/** Whether one node is a class, interface, type alias, or enum declaration. */
export function isTypeDeclaration(
  node: ts.Node,
): node is ts.ClassDeclaration | ts.InterfaceDeclaration | ts.TypeAliasDeclaration | ts.EnumDeclaration {
  return ts.isClassDeclaration(node)
    || ts.isInterfaceDeclaration(node)
    || ts.isTypeAliasDeclaration(node)
    || ts.isEnumDeclaration(node)
}

/** The declared name of one type declaration. */
export function declarationName(
  declaration: ts.ClassDeclaration | ts.InterfaceDeclaration | ts.TypeAliasDeclaration | ts.EnumDeclaration,
): string {
  return (declaration.name as ts.Identifier).text
}

/** One member's signature text with its body removed and whitespace collapsed. */
export function memberText(member: ts.TypeElement | ts.ClassElement): string {
  const sourceFile = member.getSourceFile()
  const full = member.getText(sourceFile)
  const body = (member as { body?: ts.Node }).body
  const signature = body === undefined ? full : full.slice(0, full.length - body.getText(sourceFile).length)
  return signature.replace(/\s*;?\s*$/, '').replace(/\s+/g, ' ').trim()
}

/** Print one declaration without comments or member bodies. */
export function declarationText(
  declaration: ts.ClassDeclaration | ts.InterfaceDeclaration | ts.TypeAliasDeclaration | ts.EnumDeclaration,
): string {
  const printer = ts.createPrinter({ removeComments: true })
  const projected = ts.isClassDeclaration(declaration) ? classShape(declaration) : declaration
  return printer.printNode(ts.EmitHint.Unspecified, projected, declaration.getSourceFile()).replace(/\r/g, '')
}

/** The declaration with private and protected members and every body removed. */
export function classShape(node: ts.ClassDeclaration): ts.ClassDeclaration {
  const nonPublic = (member: ts.ClassElement): boolean =>
    (ts.canHaveModifiers(member) ? ts.getModifiers(member) : undefined)?.some(modifier =>
      modifier.kind === ts.SyntaxKind.PrivateKeyword || modifier.kind === ts.SyntaxKind.ProtectedKeyword) ?? false
  const members = node.members.flatMap((member): ts.ClassElement[] => {
    if (nonPublic(member) || (ts.isPropertyDeclaration(member) && ts.isPrivateIdentifier(member.name))) return []
    if (ts.isMethodDeclaration(member)) {
      return [ts.factory.updateMethodDeclaration(
        member,
        member.modifiers,
        member.asteriskToken,
        member.name,
        member.questionToken,
        member.typeParameters,
        member.parameters,
        member.type,
        undefined,
      )]
    }
    if (ts.isConstructorDeclaration(member)) {
      return [ts.factory.updateConstructorDeclaration(member, member.modifiers, member.parameters, undefined)]
    }
    if (ts.isGetAccessorDeclaration(member)) {
      return [ts.factory.updateGetAccessorDeclaration(
        member,
        member.modifiers,
        member.name,
        member.parameters,
        member.type,
        undefined,
      )]
    }
    if (ts.isSetAccessorDeclaration(member)) {
      return [ts.factory.updateSetAccessorDeclaration(
        member,
        member.modifiers,
        member.name,
        member.parameters,
        undefined,
      )]
    }
    if (ts.isPropertyDeclaration(member)) {
      return [ts.factory.updatePropertyDeclaration(
        member,
        member.modifiers,
        member.name,
        member.questionToken ?? member.exclamationToken,
        member.type,
        undefined,
      )]
    }
    return [member]
  })
  return ts.factory.updateClassDeclaration(
    node,
    node.modifiers,
    node.name,
    node.typeParameters,
    node.heritageClauses,
    members,
  )
}

/** Project the last JSDoc block and every tag of one node into the model. */
export function documentationOf(node: ts.Node): DocumentationModel {
  const blocks = ts.getJSDocCommentsAndTags(node).filter(ts.isJSDoc)
  const block = blocks.at(-1)
  if (block === undefined) return EMPTY_DOCUMENTATION
  const description = normalizedDocText(ts.getTextOfJSDocComment(block.comment))
  const tags: JsDocTagModel[] = ts.getJSDocTags(node).map((tag) => {
    const named = tag as ts.JSDocTag & { name?: ts.Node }
    const comment = normalizedDocText(ts.getTextOfJSDocComment(tag.comment))
    return {
      name: tag.tagName.text,
      ...(named.name === undefined ? {} : { argument: named.name.getText() }),
      ...(comment === undefined ? {} : { comment }),
      text: tag.getText(tag.getSourceFile()).trim(),
    }
  })
  return {
    ...(description === undefined ? {} : {
      description,
      summary: firstSentence(description),
    }),
    tags,
    jsDoc: rawJsDoc(node),
  }
}

/** Collapse one JSDoc prose value to a single trimmed line. */
export function normalizedDocText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const normalized = value.replace(/\s+/g, ' ').trim()
  /* v8 ignore next -- TypeScript represents whitespace-only JSDoc as undefined before this helper is called. */
  return normalized.length === 0 ? undefined : normalized
}

/** The first sentence of one prose value. */
export function firstSentence(value: string): string {
  return (/^(.*?[.!?])(?:\s|$)/.exec(value)?.[1] ?? value).trim()
}

/** The source text of one node's last JSDoc block, dedented to its own line. */
export function rawJsDoc(node: ts.Node): string {
  const sourceFile = node.getSourceFile()
  const source = sourceFile.getFullText()
  const ranges = ts.getLeadingCommentRanges(source, node.getFullStart()) as ts.CommentRange[]
  const range = ranges.filter(candidate => source.slice(candidate.pos, candidate.pos + 3) === '/**').at(-1) as ts.CommentRange
  const raw = source.slice(range.pos, range.end)
  const { line } = sourceFile.getLineAndCharacterOfPosition(range.pos)
  const lineStart = sourceFile.getPositionOfLineAndCharacter(line, 0)
  const indent = source.slice(lineStart, range.pos)
  return raw.split('\n')
    .map((text, index) => index > 0 && text.startsWith(indent) ? text.slice(indent.length) : text)
    .join('\n')
}

/** The Typert mode one node's `@typert` tag declares. */
export function typertMode(node: ts.Node): 'object' | 'schema' | undefined {
  for (const tag of ts.getJSDocTags(node)) {
    if (tag.tagName.text !== 'typert') continue
    const mode = (ts.getTextOfJSDocComment(tag.comment) ?? '').trim().split(/\s+/, 1)[0]
    if (mode === 'object') return 'object'
    if (mode === '' || mode === 'schema' || mode === 'type') return 'schema'
  }
  return undefined
}

/** The `@typert service` tag of one node, when it declares one. */
export function typertServiceTag(node: ts.Node): ts.JSDocTag | undefined {
  return ts.getJSDocTags(node).find(tag => tag.tagName.text === 'typert'
    && (ts.getTextOfJSDocComment(tag.comment) ?? '').trim().split(/\s+/, 1)[0] === 'service')
}

