/**
 * Demand-driven call-site indexing for the event-relation scan: the resolved
 * call sites one local helper declaration receives, so a helper parameter can be
 * followed back to the event names its callers pass.
 */

import ts from 'typescript'
import { hasExportModifier, isDirectCallee } from './gen-doc-graphs-ts-helpers.ts'
import type { TypeScriptProject } from './ts-project.ts'

/** Calls resolved to one signature declaration, collected across an indexed file set. */
export type CallSiteIndex = Map<ts.SignatureDeclaration | ts.JSDocSignature, ts.CallExpression[]>

/**
 * Call-site index that widens from one file to the whole package source set on
 * demand, together with the locality proof that decides which one is enough.
 */
export class CallSiteIndexer {
  private readonly fileCallSites = new Map<ts.SourceFile, CallSiteIndex>()
  private readonly localCalleeProofs = new Map<ts.FunctionDeclaration, boolean>()
  private globalCallSites: CallSiteIndex | null = null

  /**
   * @param project - the loaded repository TypeScript project.
   * @param packageSourceFiles - every scanned package source file, the fallback corpus.
   */
  constructor(
    private readonly project: TypeScriptProject,
    private readonly packageSourceFiles: ReadonlySet<ts.SourceFile>,
  ) {}

  /**
   * Index resolved function calls in the given files for narrow argument-flow recovery.
   * @param files - the source files to index.
   * @returns resolved calls keyed by the signature declaration each call resolved to.
   */
  index(files: Iterable<ts.SourceFile>): CallSiteIndex {
    const index: CallSiteIndex = new Map()
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const declaration = this.project.checker.getResolvedSignature(node)?.declaration
        if (declaration) {
          const calls = index.get(declaration) ?? []
          calls.push(node)
          index.set(declaration, calls)
        }
      }
      ts.forEachChild(node, visit)
    }
    for (const file of files) visit(file)
    return index
  }

  /**
   * Return every indexed call resolving to one local helper declaration.
   * Fast path: when every same-file reference to the non-exported helper is
   * provably a direct callee, module scoping confines all of its calls to that
   * file, so only that file is indexed. Any other reference form may alias
   * the function value outward, so the original full package-source index
   * decides instead.
   * @param owner - the local helper declaration to locate calls for.
   * @returns every indexed call resolving to that declaration.
   */
  sitesFor(owner: ts.FunctionDeclaration): ts.CallExpression[] {
    if (!this.globalCallSites && !this.provenLocalCallee(owner)) {
      this.globalCallSites = this.index(this.packageSourceFiles)
    }
    if (this.globalCallSites) return this.globalCallSites.get(owner) ?? []
    const file = owner.getSourceFile()
    let index = this.fileCallSites.get(file)
    if (!index) {
      index = this.index([file])
      this.fileCallSites.set(file, index)
    }
    return index.get(owner) ?? []
  }

  /**
   * Prove every same-file reference to one helper is a direct callee. The
   * proof owns its premises: an exported helper or a helper in a global
   * script file (no import/export means program-wide scope, callable from
   * another file with no same-file reference at all) fails immediately.
   * Alias escapes (re-export statements, default exports, value reads)
   * resolve back to the owner symbol at a non-callee position and fail the
   * proof, as does anything the scan cannot positively classify.
   * @param owner - the local helper declaration whose locality to prove.
   * @returns true when every same-file reference is provably a direct callee.
   */
  private provenLocalCallee(owner: ts.FunctionDeclaration): boolean {
    const cached = this.localCalleeProofs.get(owner)
    if (cached !== undefined) return cached
    if (hasExportModifier(owner) || !ts.isExternalModule(owner.getSourceFile())) {
      this.localCalleeProofs.set(owner, false)
      return false
    }
    const name = owner.name
    const ownerSymbol = name && this.project.checker.getSymbolAtLocation(name)
    let proven = !!ownerSymbol
    const refersToOwner = (identifier: ts.Identifier): boolean => {
      // Shorthand properties resolve to the property symbol; ask for the value side.
      const local = ts.isShorthandPropertyAssignment(identifier.parent)
        ? this.project.checker.getShorthandAssignmentValueSymbol(identifier.parent)
        : this.project.checker.getSymbolAtLocation(identifier)
      if (!local) return false
      const symbol = local.flags & ts.SymbolFlags.Alias
        ? this.project.checker.getAliasedSymbol(local)
        : local
      return symbol === ownerSymbol
    }
    const visit = (node: ts.Node): void => {
      if (!proven) return
      if (ts.isIdentifier(node) && node !== name && node.text === name?.text
        && !isDirectCallee(node) && refersToOwner(node)) {
        proven = false
        return
      }
      ts.forEachChild(node, visit)
    }
    visit(owner.getSourceFile())
    this.localCalleeProofs.set(owner, proven)
    return proven
  }
}
