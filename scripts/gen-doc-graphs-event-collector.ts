/**
 * Source-visit classifier behind the event producer/consumer matrix: which
 * packages dispatch each harness-owned event and which packages listen to it,
 * resolved from the repository's real cross-file receiver types.
 */

import ts from 'typescript'
import { CallSiteIndexer } from './gen-doc-graphs-call-sites.ts'
import type { EventReceiverKind, EventRelation, PackageSource } from './gen-doc-graphs-shared.ts'
import {
  addAll,
  finiteStringTypeValues,
  hasExportModifier,
  isConstDeclaration,
  unionSets,
  unwrapExpression,
} from './gen-doc-graphs-ts-helpers.ts'
import type { TypeScriptProject } from './ts-project.ts'

/**
 * The only method names visitSource classifies; receiver typing runs on these
 * alone. Obligation: every method name matched by a branch inside visitSource
 * must appear here — the prefilter drops non-members before any branch runs,
 * so a branch for an unlisted name is silently dead.
 */
const EVENT_API_METHODS = new Set(['on', 'once', 'emit', 'parallel', 'serial', 'waterfall', 'dispatch'])

/**
 * Collect event dispatch/listener relations from real cross-file receiver types.
 *
 * TODO: the program is seeded from the host aggregate alone (ts-project.ts
 * documents why: one program cannot hold both faces' Context merges), so a
 * Client package enters only when a host file imports it. Client-face
 * listeners on client-face events are therefore under-reported —
   * `connection/reset` omits `ui-skill`/`ui-agent-preset`. Closing it needs a
   * second Client program whose relations merge into these, not a wider seed.
 */
export class EventRelationCollector {
  private readonly relations = new Map<string, EventRelation>()
  private readonly callSites: CallSiteIndexer
  private readonly contextType: ts.Type
  private readonly agentDispatchType: ts.Type
  private readonly eventsServiceType: ts.Type

  constructor(
    private readonly project: TypeScriptProject,
    private readonly sources: readonly PackageSource[],
  ) {
    this.contextType = this.declaredType('vendor/cordis/src/context.ts', 'Context')
    this.agentDispatchType = this.declaredType('packages/core/agent/src/dispatch.ts', 'AgentEventDispatch')
    this.eventsServiceType = this.declaredType('vendor/cordis/src/events.ts', 'EventsService')
    const packageSourceFiles = new Set(sources.map(source => source.sourceFile))
    this.callSites = new CallSiteIndexer(project, packageSourceFiles)
  }

  /** Return all event relations discovered from the Program. */
  collect(): Map<string, EventRelation> {
    for (const source of this.sources) this.visitSource(source)
    return this.relations
  }

  /** Resolve one named class/interface declaration to its merged instance type. */
  private declaredType(relativePath: string, name: string): ts.Type {
    const sourceFile = this.project.sourceFile(relativePath)
    const declaration = sourceFile.statements.find((statement): statement is ts.ClassDeclaration | ts.InterfaceDeclaration => {
      return (ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement)) && statement.name?.text === name
    })
    const symbol = declaration?.name && this.project.checker.getSymbolAtLocation(declaration.name)
    if (!symbol) throw new Error(`cannot resolve TypeScript type ${name} from ${relativePath}`)
    return this.project.checker.getDeclaredTypeOfSymbol(symbol)
  }

  /** Walk one package source file and classify event API calls by receiver type. */
  private visitSource(source: PackageSource): void {
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        if (this.isAgentEventEmitter(node.expression)) {
          const event = node.arguments[2]
          if (event) {
            for (const name of this.finiteStringValues(event) ?? []) {
              this.addDispatcher(name, source.pkg, 'emitAgentEvent')
            }
          }
        } else if (ts.isPropertyAccessExpression(node.expression) && EVENT_API_METHODS.has(node.expression.name.text)) {
          const receiverKind = this.receiverKind(node.expression.expression)
          const method = node.expression.name.text
          if (receiverKind === 'events-service' && method === 'dispatch') {
            const argumentList = node.arguments[1]
            if (argumentList) {
              for (const event of this.eventNamesFromArgumentList(argumentList, new Set())) {
                this.addDispatcher(event, source.pkg, 'events.dispatch')
              }
            }
          } else if (receiverKind === 'context' || receiverKind === 'agent-dispatch') {
            const eventNames = this.eventNamesFromCall(node, receiverKind)
            if (method === 'on' || method === 'once') {
              for (const event of eventNames) this.ensure(event).listeners.add(source.pkg)
            } else if (method === 'emit' || method === 'parallel' || method === 'serial' || method === 'waterfall') {
              for (const event of eventNames) this.addDispatcher(event, source.pkg, method)
            }
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source.sourceFile)
  }

  /** Match the exported contained-notification helper by declaration identity. */
  private isAgentEventEmitter(expression: ts.Expression): boolean {
    if (!ts.isIdentifier(expression)) return false
    const local = this.project.checker.getSymbolAtLocation(expression)
    if (!local) return false
    const symbol = local.flags & ts.SymbolFlags.Alias
      ? this.project.checker.getAliasedSymbol(local)
      : local
    const declarations = symbol.declarations ?? []
    return declarations.some((declaration) => {
      return ts.isFunctionDeclaration(declaration)
        && declaration.name?.text === 'emitAgentEvent'
        && this.project.relativePath(declaration.getSourceFile()) === 'packages/core/agent/src/dispatch.ts'
    })
  }

  /** Classify a receiver using assignability to the repository's actual event API types. */
  private receiverKind(receiver: ts.Expression): EventReceiverKind | undefined {
    const type = this.project.checker.getTypeAtLocation(receiver)
    if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) return undefined
    if (this.project.checker.isTypeAssignableTo(type, this.eventsServiceType)) return 'events-service'
    if (this.project.checker.isTypeAssignableTo(type, this.contextType)) return 'context'
    if (this.project.checker.isTypeAssignableTo(type, this.agentDispatchType)) return 'agent-dispatch'
    return undefined
  }

  /** Resolve the event-name argument for Context and fused agent dispatch calls. */
  private eventNamesFromCall(call: ts.CallExpression, receiverKind: Exclude<EventReceiverKind, 'events-service'>): Set<string> {
    const candidates = receiverKind === 'context' ? call.arguments.slice(0, 2) : call.arguments.slice(0, 1)
    for (const candidate of candidates) {
      const values = this.finiteStringValues(candidate)
      if (values) return values
    }
    return new Set()
  }

  /** Recover the event slot from the argument array handed to EventsService.dispatch(). */
  private eventNamesFromArgumentList(expression: ts.Expression, seen: Set<ts.Node>): Set<string> {
    const current = unwrapExpression(expression)
    if (seen.has(current)) return new Set()
    seen.add(current)

    if (ts.isArrayLiteralExpression(current)) {
      for (const element of current.elements.slice(0, 2)) {
        if (ts.isOmittedExpression(element) || ts.isSpreadElement(element)) continue
        const values = this.finiteStringValues(element)
        if (values) return values
      }
      return new Set()
    }
    if (ts.isConditionalExpression(current)) {
      return unionSets(
        this.eventNamesFromArgumentList(current.whenTrue, new Set(seen)),
        this.eventNamesFromArgumentList(current.whenFalse, new Set(seen)),
      )
    }
    if (!ts.isIdentifier(current)) return new Set()

    const symbol = this.project.checker.getSymbolAtLocation(current)
    if (!symbol) return new Set()
    const events = new Set<string>()
    for (const declaration of symbol.declarations ?? []) {
      if (ts.isVariableDeclaration(declaration) && declaration.initializer && isConstDeclaration(declaration)) {
        addAll(events, this.eventNamesFromArgumentList(declaration.initializer, new Set(seen)))
      } else if (ts.isParameter(declaration)) {
        addAll(events, this.eventNamesFromParameter(declaration, seen))
      }
    }
    return events
  }

  /** Follow a non-exported local helper parameter back to every resolved call site. */
  private eventNamesFromParameter(parameter: ts.ParameterDeclaration, seen: Set<ts.Node>): Set<string> {
    const owner = parameter.parent
    if (!ts.isFunctionDeclaration(owner) || hasExportModifier(owner)) return new Set()
    const index = owner.parameters.indexOf(parameter)
    if (index < 0) return new Set()
    const events = new Set<string>()
    for (const call of this.callSites.sitesFor(owner)) {
      const argument = call.arguments[index]
      if (argument) addAll(events, this.eventNamesFromArgumentList(argument, new Set(seen)))
    }
    return events
  }

  /** Return a finite string-literal value set, rejecting widened and generic strings. */
  private finiteStringValues(expression: ts.Expression): Set<string> | undefined {
    const current = unwrapExpression(expression)
    if (ts.isStringLiteralLike(current)) return new Set([current.text])
    if (this.isForwardedAgentEventParameter(current)) return undefined
    return finiteStringTypeValues(this.project.checker.getTypeAtLocation(current))
  }

  /** Reject the contextual parameter inside the AgentEventDispatch forwarding object. */
  private isForwardedAgentEventParameter(expression: ts.Expression): boolean {
    if (!ts.isIdentifier(expression)) return false
    const declarations = this.project.checker.getSymbolAtLocation(expression)?.declarations ?? []
    return declarations.some((declaration) => {
      if (!ts.isParameter(declaration)) return false
      const method = declaration.parent
      if (!ts.isMethodDeclaration(method) || !ts.isObjectLiteralExpression(method.parent)) return false
      const contextualType = this.project.checker.getContextualType(method.parent)
      return contextualType !== undefined
        && this.project.checker.isTypeAssignableTo(contextualType, this.agentDispatchType)
    })
  }

  /** Get or create one relation row. */
  private ensure(event: string): EventRelation {
    const existing = this.relations.get(event)
    if (existing) return existing
    const relation = { dispatchers: new Map<string, Set<string>>(), listeners: new Set<string>() }
    this.relations.set(event, relation)
    return relation
  }

  /** Add one dispatcher method without duplicating package/method labels. */
  private addDispatcher(event: string, pkg: string, method: string): void {
    const relation = this.ensure(event)
    const methods = relation.dispatchers.get(pkg) ?? new Set<string>()
    methods.add(method)
    relation.dispatchers.set(pkg, methods)
  }
}
