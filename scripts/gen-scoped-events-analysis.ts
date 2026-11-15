/** Program-backed analyzer and renderer for the generated scoped-event resolvers. */

import ts from 'typescript'
import { pointer, rawJsDoc } from './jsdoc.ts'
import { subjectCandidates, typeText, typesEquivalent, normalizedType } from './gen-scoped-events-candidates.ts'
import { isCordisModuleInterface, isThisParameter, parseScopeTag } from './gen-scoped-events-rules.ts'
import type { ScopeTargetContract, ScopedEventResolver } from './gen-scoped-events-types.ts'
import { TypeScriptProject } from './ts-project.ts'

const SCOPE_DOC_MARKER = 'Scope-filtered dispatch'

/** Program-backed analyzer and renderer for the generated scoped-event resolvers. */
export class ScopedEventGenerator {
  private readonly checker: ts.TypeChecker
  private readonly packageSources: ts.SourceFile[]
  private readonly scopeTargetDeclaration: ts.FunctionDeclaration
  private readonly scopedSymbol: ts.Symbol
  private readonly violations: string[] = []

  /** @param project - the repository program the contracts and events are read from. */
  constructor(private readonly project: TypeScriptProject) {
    this.checker = project.checker
    this.packageSources = project.sourceFiles().filter((sourceFile) => {
      return /^packages\/[^/]+\/[^/]+\/src\/.+\.ts$/.test(project.relativePath(sourceFile))
    })
    this.scopeTargetDeclaration = this.functionDeclaration(
      'packages/core/scope/src/index.ts',
      'scopeTarget',
    )
    this.scopedSymbol = this.typeAliasSymbol(
      'packages/core/scope/src/index.ts',
      'Scoped',
    )
  }

  /** Render the complete generated TypeScript module or throw every contract violation. */
  render(): string {
    const contracts = this.collectScopeTargetContracts()
    const resolvers = this.collectScopedEventResolvers(contracts)
    if (this.violations.length > 0) {
      throw new Error(
        `gen-scoped-events: ${this.violations.length} scoped-event contract violation(s):\n`
        + this.violations.map(violation => `  - ${violation}`).join('\n'),
      )
    }
    return [
      '/**',
      ' * Generated scoped-event routing-subject resolvers for dsh-scope invariants.',
      ' * Do not edit by hand; run `pnpm run gen-scoped-events`.',
      ' *',
      ' * @module @deepseek-ai/dsh-scope/scoped-events.generated',
      ' */',
      '',
      'type ScopedSubjectResolver = (args: readonly unknown[]) => unknown',
      '',
      'const scopedSubjectResolvers: Readonly<Record<string, ScopedSubjectResolver | null>> = Object.freeze({',
      ...resolvers.map(({ event, candidate }) => {
        if (candidate === null) return `  '${event}': null,`
        const subject = candidate.property === undefined
          ? `args[${candidate.parameter}]`
          : `(args[${candidate.parameter}] as Record<string, unknown>)[${quote(candidate.property)}]`
        return `  '${event}': args => ${subject},`
      }),
      '})',
      '',
      '/**',
      ' * Resolve the routing key named by one scoped event payload. A null',
      ' * resolver means the payload cannot expose its external routing key, so the',
      ' * invariant checks carrier presence only.',
      ' * @param event - runtime Cordis event name.',
      ' * @returns the generated subject resolver, null for presence-only,',
      ' *   or undefined when the event is not scope-filtered.',
      ' */',
      'export function scopedSubjectResolverFor(event: string): ScopedSubjectResolver | null | undefined {',
      '  return scopedSubjectResolvers[event]',
      '}',
      '',
    ].join('\n')
  }

  /** Resolve one named function declaration from a known source file. */
  private functionDeclaration(relativePath: string, name: string): ts.FunctionDeclaration {
    const sourceFile = this.project.sourceFile(relativePath)
    const declaration = sourceFile.statements.find((statement): statement is ts.FunctionDeclaration => {
      return ts.isFunctionDeclaration(statement) && statement.name?.text === name
    })
    if (!declaration) throw new Error(`gen-scoped-events: cannot resolve function ${name} from ${relativePath}`)
    return declaration
  }

  /** Resolve one named type-alias symbol from a known source file. */
  private typeAliasSymbol(relativePath: string, name: string): ts.Symbol {
    const sourceFile = this.project.sourceFile(relativePath)
    const declaration = sourceFile.statements.find((statement): statement is ts.TypeAliasDeclaration => {
      return ts.isTypeAliasDeclaration(statement) && statement.name.text === name
    })
    const symbol = declaration && this.checker.getSymbolAtLocation(declaration.name)
    if (!symbol) throw new Error(`gen-scoped-events: cannot resolve type ${name} from ${relativePath}`)
    return symbol
  }

  /** Collect every real scopeTarget(base, key) base/key type contract. */
  private collectScopeTargetContracts(): ScopeTargetContract[] {
    const contracts: ScopeTargetContract[] = []
    const visit = (sourceFile: ts.SourceFile, node: ts.Node): void => {
      if (ts.isCallExpression(node)
        && this.checker.getResolvedSignature(node)?.declaration === this.scopeTargetDeclaration) {
        const base = node.arguments[0]
        const key = node.arguments[1]
        if (!base || !key) {
          const source = pointer(this.project.relativePath(sourceFile), sourceFile, node)
          this.violations.push(`${source} calls scopeTarget without base and key arguments`)
        } else {
          contracts.push({
            baseType: this.checker.getTypeAtLocation(base),
            keyType: this.checker.getTypeAtLocation(key),
            source: pointer(this.project.relativePath(sourceFile), sourceFile, node),
          })
        }
      }
      ts.forEachChild(node, (child) => { visit(sourceFile, child) })
    }
    for (const sourceFile of this.packageSources) visit(sourceFile, sourceFile)
    return contracts
  }

  /** Collect every Events member and derive its generated resolver. */
  private collectScopedEventResolvers(contracts: readonly ScopeTargetContract[]): ScopedEventResolver[] {
    const resolvers: ScopedEventResolver[] = []
    for (const sourceFile of this.packageSources) {
      const rel = this.project.relativePath(sourceFile)
      const visit = (node: ts.Node): void => {
        if (ts.isInterfaceDeclaration(node) && node.name.text === 'Events' && isCordisModuleInterface(node)) {
          for (const member of node.members) {
            if (!ts.isMethodSignature(member) || !ts.isStringLiteral(member.name)) continue
            const event = member.name.text
            const raw = rawJsDoc(sourceFile.text, member)
            const where = `event '${event}' (${pointer(rel, sourceFile, member)})`
            const tag = parseScopeTag(raw, where, this.violations)
            const thisParameter = member.parameters.find(isThisParameter)
            const scopedBase = thisParameter && this.scopedBaseType(thisParameter)
            if (!scopedBase) {
              if (raw.includes(SCOPE_DOC_MARKER)) {
                this.violations.push(
                  `${where} documents scope-filtered dispatch but its signature has no this: Scoped<...> receiver`,
                )
              }
              if (tag.present) {
                this.violations.push(`${where} has @dshScopeScan metadata but is not a Scoped event`)
              }
              continue
            }
            if (!raw.includes(SCOPE_DOC_MARKER)) {
              this.violations.push(
                `${where} has this: Scoped<...> but its JSDoc does not explain "${SCOPE_DOC_MARKER}"`,
              )
            }
            const keyType = this.routingKeyType(where, scopedBase, contracts)
            if (!keyType) continue
            const candidates = subjectCandidates(this.checker, member)
              .filter(candidate => typesEquivalent(this.checker, candidate.type, keyType))
            if (candidates.length > 1) {
              this.violations.push(
                `${where} has multiple routing-key candidates for ${typeText(this.checker, keyType)}: `
                + candidates.map(candidate => `${candidate.path}: ${typeText(this.checker, candidate.type)}`).join(', '),
              )
              continue
            }
            if (candidates.length === 0) {
              if (!tag.unsupported) {
                const keyLabel = typeText(this.checker, keyType)
                this.violations.push(
                  `${where} exposes no parameter or one-level property equivalent to routing key type ${keyLabel}; `
                  + 'add @dshScopeScan unsupported only when the key is intentionally absent from the payload',
                )
              }
              resolvers.push({ event, candidate: null })
              continue
            }
            if (tag.unsupported) {
              this.violations.push(
                `${where} has unnecessary @dshScopeScan unsupported; ${candidates[0]?.path} exposes the routing key`,
              )
              continue
            }
            resolvers.push({ event, candidate: candidates[0] ?? null })
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(sourceFile)
    }
    return resolvers.sort((left, right) => left.event.localeCompare(right.event))
  }

  /** Extract the Base type from one exact this: Scoped<Base> parameter. */
  private scopedBaseType(parameter: ts.ParameterDeclaration): ts.Type | undefined {
    const type = this.checker.getTypeAtLocation(parameter)
    if (type.aliasSymbol !== this.scopedSymbol) return undefined
    return type.aliasTypeArguments?.[0]
  }

  /** Resolve one unambiguous key type for a scoped carrier base. */
  private routingKeyType(
    where: string,
    scopedBase: ts.Type,
    contracts: readonly ScopeTargetContract[],
  ): ts.Type | undefined {
    const matches = contracts.filter((contract) => {
      return this.checker.isTypeAssignableTo(
        normalizedType(this.checker, contract.baseType),
        normalizedType(this.checker, scopedBase),
      )
    })
    if (matches.length === 0) {
      this.violations.push(
        `${where} has no matching scopeTarget(base, key) call for carrier base ${typeText(this.checker, scopedBase)}`,
      )
      return undefined
    }
    const keyTypes: ts.Type[] = []
    for (const match of matches) {
      if (!keyTypes.some(type => typesEquivalent(this.checker, type, match.keyType))) keyTypes.push(match.keyType)
    }
    if (keyTypes.length > 1) {
      this.violations.push(
        `${where} carrier base ${typeText(this.checker, scopedBase)} has inconsistent routing-key types: `
        + matches.map(match => `${typeText(this.checker, match.keyType)} at ${match.source}`).join(', '),
      )
      return undefined
    }
    return keyTypes[0]
  }
}

/** Quote a generated property key as a single-quoted TypeScript string. */
function quote(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`
}
