/** Body-stripped public API projection of a class declaration. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { repoRoot } from './verify-type-equiv-model.ts'
import { sourceJSDoc } from './verify-type-equiv-declarations.ts'

/** Whether a class member is part of its public declaration. */
function isPublicMember(member: ts.ClassElement): boolean {
  if (ts.isClassStaticBlockDeclaration(member)) return false
  const name = ts.getNameOfDeclaration(member)
  if (name && ts.isPrivateIdentifier(name)) return false
  const modifiers = ts.canHaveModifiers(member) ? ts.getModifiers(member) : undefined
  return !(modifiers?.some(modifier =>
    modifier.kind === ts.SyntaxKind.PrivateKeyword
    || modifier.kind === ts.SyntaxKind.ProtectedKeyword,
  ) ?? false)
}

/** Remove an implementation body while retaining the source signature. */
function bodylessMember(text: string, sf: ts.SourceFile, member: ts.ClassElement): string {
  const start = member.getStart(sf)
  let end = member.end
  if (ts.isConstructorDeclaration(member) || ts.isMethodDeclaration(member)
    || ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) {
    if (member.body) end = member.body.getStart(sf)
  }
  if (ts.isPropertyDeclaration(member) && member.initializer) end = member.initializer.getStart(sf)
  const signature = text.slice(start, end).trimEnd().replace(/;$/, '').replace(/=\s*$/, '').trimEnd()
  return `${signature};`
}

/**
 * Render a class as an ambient declaration containing only its public fields,
 * constructor, accessors, and methods. Implementation bodies and private or
 * protected members are deliberately absent; original class/member JSDoc is
 * retained so the projection is the source-owned public contract.
 */
export function sourcePublicApi(sourceRel: string, symbol: string): string | null {
  const abs = resolve(repoRoot, sourceRel)
  const text = readFileSync(abs, 'utf8')
  const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, /* setParentNodes */ true)
  for (const stmt of sf.statements) {
    if (!ts.isClassDeclaration(stmt) || stmt.name?.text !== symbol) continue
    const classDoc = sourceJSDoc(text, stmt)
    const abstract = stmt.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AbstractKeyword) ? 'abstract ' : ''
    const typeParameters = stmt.typeParameters?.map(parameter => parameter.getText(sf)).join(', ')
    const heritage = stmt.heritageClauses?.map(clause => clause.getText(sf)).join(' ')
    const header = `declare ${abstract}class ${symbol}${typeParameters ? `<${typeParameters}>` : ''}${heritage ? ` ${heritage}` : ''} {`
    const members = stmt.members
      .filter(isPublicMember)
      .map((member) => {
        const jsDoc = sourceJSDoc(text, member)
        const declaration = bodylessMember(text, sf, member)
        return jsDoc === '' ? declaration : `${jsDoc}\n${declaration}`
      })
    const declaration = [header, ...members.map(member => member.split('\n').map(line => `  ${line}`).join('\n')), '}'].join('\n')
    return classDoc === '' ? declaration : `${classDoc}\n${declaration}`
  }
  return null
}
