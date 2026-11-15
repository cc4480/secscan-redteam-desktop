/**
 * Member-document extraction for the Cordis core API reference: one declaration
 * group becomes the heading, signatures, JSDoc prose, tags, and source pointer
 * the renderer emits, with missing documentation recorded as a violation.
 */

import ts from 'typescript'
import { checkParams, checkReturns, parseJsDoc, parseTags, pointer } from './jsdoc.ts'
import { load, sourceJsDoc, type RenderContext } from './cordis-core-api-source.ts'

/** One rendered member group: its heading, signatures, and documented contract. */
export interface MemberDoc {
  name: string
  heading: string
  signatures: string[]
  jsDoc: string
  doc: string
  params: { name: string; text: string }[]
  returns: string | null
  source: string
}

/** Class or interface members that can declare one documented API. */
export type Member = ts.MethodDeclaration
  | ts.MethodSignature
  | ts.PropertyDeclaration
  | ts.PropertySignature
  | ts.GetAccessorDeclaration

function signatureOf(member: ts.Node, sf: ts.SourceFile): string {
  const full = member.getText(sf)
  const tail = (member as { body?: ts.Node; initializer?: ts.Node }).body
    ?? (member as { initializer?: ts.Node }).initializer
  const signature = tail
    ? full.slice(0, full.length - tail.getText(sf).length).replace(/[=\s]+$/, '')
    : full
  return signature.replace(/\s*;?\s*$/, '').replace(/\s+/g, ' ').trim()
}

function headingParams(parameters: readonly ts.ParameterDeclaration[], sf: ts.SourceFile): string {
  const names = parameters
    .filter(parameter => !(ts.isIdentifier(parameter.name) && parameter.name.text === 'this'))
    .map((parameter) => {
      const rest = parameter.dotDotDotToken ? '...' : ''
      const optional = parameter.questionToken || parameter.initializer ? '?' : ''
      return `${rest}${parameter.name.getText(sf)}${optional}`
    })
  return `(${names.join(', ')})`
}

/**
 * Reduce one declaration group to the member documentation the renderer emits.
 * @param ctx - render state; undocumented members are recorded on it.
 * @param where - the member's page-facing name, used in violation text.
 * @param name - bare member name.
 * @param group - every declaration sharing that name.
 * @param rel - scan-root-relative path the group was read from.
 * @returns the documented member group.
 */
export function memberDoc(ctx: RenderContext, where: string, name: string, group: Member[], rel: string): MemberDoc {
  const { sf, text } = load(ctx, rel)
  const first = group[0]
  if (first === undefined) throw new Error(`cordis-core-api: empty member group for ${name}.`)
  const rawDocs = group.map(member => sourceJsDoc(text, sf, member))
  const docIndex = rawDocs.findIndex(raw => parseJsDoc(raw).doc !== '')
  const raw = docIndex === -1 ? '' : (rawDocs[docIndex] ?? '')
  const doc = parseJsDoc(raw).doc
  if (doc === '') ctx.violations.push(`${where} has no JSDoc prose.`)
  const { params: tags, returns } = parseTags(raw)
  const functionMembers = group.filter((member): member is ts.MethodDeclaration | ts.MethodSignature =>
    ts.isMethodDeclaration(member) || ts.isMethodSignature(member))
  const docCarrier = functionMembers[docIndex === -1 ? 0 : docIndex]
  const params: { name: string; text: string }[] = []
  if (docCarrier !== undefined) {
    checkParams(where, 'cordis-core-api', docCarrier.parameters, tags, sf,
      parameter => ts.isIdentifier(parameter.name) && parameter.name.text === 'this', ctx.violations)
    if (docCarrier.type !== undefined) {
      checkReturns(where, docCarrier.type, returns, sf, ctx.violations)
    } else if (returns === null && ts.isMethodDeclaration(docCarrier)) {
      ctx.violations.push(`${where} has no return type annotation; document the result with @returns.`)
    }
    for (const parameter of docCarrier.parameters) {
      if (!ts.isIdentifier(parameter.name) || parameter.name.text === 'this') continue
      const text = tags.get(parameter.name.text)
      if (text !== undefined) params.push({ name: parameter.name.text, text })
    }
  }
  const headingSource = docCarrier ?? functionMembers[0]
  const signatures = ts.isMethodDeclaration(first) && functionMembers.length > 1
    ? functionMembers.filter(member => ts.isMethodDeclaration(member) && member.body === undefined)
    : group
  return {
    name,
    heading: headingSource === undefined ? '' : headingParams(headingSource.parameters, sf),
    signatures: signatures.map(member => signatureOf(member, sf)),
    jsDoc: raw,
    doc,
    params,
    returns,
    source: pointer(rel, sf, first),
  }
}
