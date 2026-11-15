/**
 * Section collection for the Cordis core API reference: the members a `Context`
 * module merge contributes, and the instance and static members of a documented
 * class together with any interface members merged onto it.
 */

import ts from 'typescript'
import { cordisModuleBody } from './cordis-walk.ts'
import { parseJsDoc, pointer, rawJsDoc } from './jsdoc.ts'
import { load, type RenderContext } from './cordis-core-api-source.ts'
import { memberDoc, type Member, type MemberDoc } from './cordis-core-api-members.ts'

function isPublicInstance(member: ts.ClassElement): boolean {
  const modifiers = ts.getCombinedModifierFlags(member)
  if (modifiers & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected | ts.ModifierFlags.Static)) return false
  if (!member.name || ts.isComputedPropertyName(member.name) || ts.isPrivateIdentifier(member.name)) return false
  return !member.name.getText().startsWith('_')
}

function isPublicStatic(member: ts.ClassElement): boolean {
  const modifiers = ts.getCombinedModifierFlags(member)
  if (modifiers & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) return false
  if (!(modifiers & ts.ModifierFlags.Static)) return false
  if (!member.name || ts.isComputedPropertyName(member.name) || ts.isPrivateIdentifier(member.name)) return false
  return !member.name.getText().startsWith('_')
}

function heritageMembers(
  statement: ts.InterfaceDeclaration,
  sf: ts.SourceFile,
  groups: Map<string, (ts.MethodSignature | ts.PropertySignature | ts.MethodDeclaration)[]>,
): void {
  for (const clause of statement.heritageClauses ?? []) {
    for (const type of clause.types) {
      if (!ts.isIdentifier(type.expression) || type.expression.text !== 'Pick') continue
      const [target, keys] = type.typeArguments ?? []
      if (target === undefined || keys === undefined || !ts.isTypeReferenceNode(target)) continue
      const targetName = target.typeName.getText(sf)
      const cls = sf.statements.find(
        (entry): entry is ts.ClassDeclaration => ts.isClassDeclaration(entry) && entry.name?.text === targetName,
      )
      if (cls === undefined) continue
      const picked = new Set<string>()
      const collect = (node: ts.TypeNode): void => {
        if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) picked.add(node.literal.text)
        if (ts.isUnionTypeNode(node)) node.types.forEach(collect)
      }
      collect(keys)
      for (const member of cls.members) {
        if (!ts.isMethodDeclaration(member)) continue
        const name = member.name.getText(sf)
        if (!picked.has(name)) continue
        const group = groups.get(name) ?? []
        group.push(member)
        groups.set(name, group)
      }
    }
  }
}

/**
 * Collect every member a source file merges onto `Context`, including members
 * picked from a context class through the interface's `Pick` heritage.
 * @param ctx - render state; undocumented members are recorded on it.
 * @param rel - scan-root-relative path of the merging source file.
 * @returns one documented member group per merged member name.
 */
export function contextMergeMembers(ctx: RenderContext, rel: string): MemberDoc[] {
  const { sf } = load(ctx, rel)
  const body = cordisModuleBody(sf)
  if (body === null) throw new Error(`cordis-core-api: ${rel} has no Context module merge.`)
  const groups = new Map<string, (ts.MethodSignature | ts.PropertySignature | ts.MethodDeclaration)[]>()
  for (const statement of body.statements) {
    if (!ts.isInterfaceDeclaration(statement) || statement.name.text !== 'Context') continue
    heritageMembers(statement, sf, groups)
    for (const member of statement.members) {
      if (!ts.isMethodSignature(member) && !ts.isPropertySignature(member)) continue
      if (ts.isComputedPropertyName(member.name)) continue
      const name = member.name.getText(sf)
      const group = groups.get(name) ?? []
      group.push(member)
      groups.set(name, group)
    }
  }
  return [...groups.entries()].map(([name, group]) =>
    memberDoc(ctx, `ctx.${name} (${rel})`, name, group, rel))
}

/**
 * Collect a class's documented API: its own public instance and static members,
 * plus property signatures an interface of the same name merges onto it.
 * @param ctx - render state; undocumented members are recorded on it.
 * @param rel - scan-root-relative path of the declaring source file.
 * @param className - the class to document.
 * @returns the class JSDoc, its instance and static member groups, and its source pointer.
 */
export function classMembers(ctx: RenderContext, rel: string, className: string): {
  doc: string
  instance: MemberDoc[]
  statics: MemberDoc[]
  source: string
} {
  const { sf, text } = load(ctx, rel)
  const cls = sf.statements.find(
    (statement): statement is ts.ClassDeclaration =>
      ts.isClassDeclaration(statement) && statement.name?.text === className,
  )
  if (cls === undefined) throw new Error(`cordis-core-api: class ${className} not found in ${rel}.`)
  const doc = parseJsDoc(rawJsDoc(text, cls)).doc
  if (doc === '') ctx.violations.push(`class ${className} (${pointer(rel, sf, cls)}) has no JSDoc.`)
  const instance = new Map<string, Member[]>()
  const statics = new Map<string, Member[]>()
  for (const member of cls.members) {
    if (!ts.isMethodDeclaration(member) && !ts.isPropertyDeclaration(member) && !ts.isGetAccessorDeclaration(member)) continue
    const name = member.name.getText(sf)
    if (isPublicInstance(member)) {
      const group = instance.get(name) ?? []
      group.push(member)
      instance.set(name, group)
    } else if (isPublicStatic(member) && !ts.isGetAccessorDeclaration(member)) {
      const group = statics.get(name) ?? []
      group.push(member)
      statics.set(name, group)
    }
  }
  const declaration = sf.statements.find(
    (statement): statement is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(statement) && statement.name.text === className,
  )
  for (const member of declaration?.members ?? []) {
    if (!ts.isPropertySignature(member) || ts.isComputedPropertyName(member.name)) continue
    const name = member.name.getText(sf)
    const group = instance.get(name) ?? []
    group.push(member)
    instance.set(name, group)
  }
  const render = (groups: Map<string, Member[]>, prefix: string): MemberDoc[] =>
    [...groups.entries()].map(([name, group]) => memberDoc(ctx, `${prefix}${name} (${rel})`, name, group, rel))
  return {
    doc,
    instance: render(instance, `${className}#`),
    statics: render(statics, `${className}.`),
    source: pointer(rel, sf, cls),
  }
}
