/**
 * Extraction of one face: walk each package's public export graph, project its Typert business declarations into the model, and collect the annotations write mode inserts.
 *
 * @module @deepseek-ai/dsh-typert-generator/face-analyzer
 */

import { relative } from 'node:path'
import ts from 'typescript'
import {
  EMPTY_DOCUMENTATION,
  PUBLIC_REMOTE_TYPE_ROOTS,
  SourceEditQueued,
  TypertAnalysisError,
} from './analyzer-types.ts'
import type {
  AnalysisMode,
  ExportRecord,
  ForwardedExport,
  GatewayBinding,
  ModuleIdentity,
  PackageImport,
  PackageRegistration,
  ReferenceSite,
  SourceEdit,
  StaticContextDeclaration,
  StaticLookupDeclaration,
  TypeNodeInput,
} from './analyzer-types.ts'
import {
  declarationName,
  declarationText,
  documentationOf,
  isTypeDeclaration,
  memberText,
  optionalParent,
  preferredDeclaration,
  typertMode,
  typertServiceTag,
} from './analyzer-declaration.ts'
import { isWithin, realPath, slash, uniqueBy } from './analyzer-diagnostic.ts'
import { hasPackageSurface, packageExportTargets, sourcePathForExport } from './analyzer-manifest.ts'
import {
  annotationPosition,
  exposableMember,
  hasModifier,
  isRemoteSegment,
  keywordName,
  literalModel,
  memberName,
  modifierMode,
  packageExportSpecifier,
  stringLiteralValue,
  visibilityOf,
} from './analyzer-member.ts'
import {
  authoredExportName,
  externalModuleIdentityForFile,
  importBindingOf,
  importTypeAttributesText,
  isStandardLibraryFile,
  moduleIdentity,
  moduleSpecifierOf,
} from './analyzer-module.ts'
import type {
  CrossFaceLink,
  EventModel,
  EnumMemberModel,
  FaceModel,
  InvocationModel,
  InvocationParameterModel,
  MemberBase,
  MemberModel,
  MemberVisibility,
  ObjectModel,
  PackageModel,
  ParameterModel,
  RemoteBoundaryModel,
  RemoteTypeImportModel,
  SchemaModel,
  ServiceModel,
  SignatureModel,
  SourceLocation,
  SymbolId,
  TypeDeclarationModel,
  TypeNodeId,
  TypeNodeModel,
  TypeOperatorName,
  TypeParameterModel,
  TypeTargetModel,
  TypertFace,
} from './model.ts'

/** What one face analysis receives from the workspace pass. */
export interface FaceAnalyzerOptions {
  readonly root: string
  readonly face: TypertFace
  readonly program: ts.Program
  /** Program host whose module-resolution cache serves import resolution outside the checker. */
  readonly host: ts.CompilerHost
  readonly registrations: readonly PackageRegistration[]
  readonly allRegistrations: readonly PackageRegistration[]
  readonly mode: AnalysisMode
  readonly queueEdit: (edit: SourceEdit) => void
  readonly crossFaceLinks: Map<string, CrossFaceLink>
}

export class FaceAnalyzer {
  private readonly root: string
  private readonly face: TypertFace
  private readonly program: ts.Program
  private readonly host: ts.CompilerHost
  private readonly checker: ts.TypeChecker
  private readonly registrations: readonly PackageRegistration[]
  private readonly allRegistrations: readonly PackageRegistration[]
  private readonly mode: AnalysisMode
  private readonly queueEdit: (edit: SourceEdit) => void
  private readonly crossFaceLinks: Map<string, CrossFaceLink>
  private readonly sourceFiles = new Map<string, ts.SourceFile>()
  private readonly declarations = new Map<SymbolId, TypeDeclarationModel>()
  private readonly declarationStates = new Set<SymbolId>()
  private readonly nodes = new Map<TypeNodeId, TypeNodeModel>()
  private readonly exportsByPackage = new Map<string, ExportRecord[]>()
  private readonly nodeOrdinals = new Map<string, number>()
  private staticLookups: readonly StaticLookupDeclaration[] | undefined
  private staticContexts: ReadonlyMap<string, StaticContextDeclaration> | undefined

  constructor(options: FaceAnalyzerOptions) {
    this.root = options.root
    this.face = options.face
    this.program = options.program
    this.host = options.host
    this.checker = options.program.getTypeChecker()
    this.registrations = options.registrations
    this.allRegistrations = options.allRegistrations
    this.mode = options.mode
    this.queueEdit = options.queueEdit
    this.crossFaceLinks = options.crossFaceLinks
    for (const sourceFile of this.program.getSourceFiles()) {
      this.sourceFiles.set(realPath(sourceFile.fileName), sourceFile)
    }
  }

  analyze(): FaceModel {
    for (const registration of this.registrations) {
      this.exportsByPackage.set(registration.name, this.collectExports(registration))
    }
    const packages = this.registrations
      .map(registration => this.analyzePackage(registration))
      .filter(hasPackageSurface)
    this.validateInvocationIdentity(packages)
    return {
      face: this.face,
      packages,
      graph: {
        declarations: [...this.declarations.values()].sort((left, right) => left.id.localeCompare(right.id)),
        nodes: [...this.nodes.values()].sort((left, right) => left.id.localeCompare(right.id)),
      },
    }
  }

  private analyzePackage(registration: PackageRegistration): PackageModel {
    const records = this.exportsByPackage.get(registration.name) as ExportRecord[]
    const reachable = this.reachableFiles(registration, records.map(record => record.sourceFile))
    const services: ServiceModel[] = []
    const events: EventModel[] = []

    for (const sourceFile of reachable) {
      for (const statement of sourceFile.statements) {
        if (!ts.isModuleDeclaration(statement)
          || !ts.isStringLiteral(statement.name)
          || statement.name.text !== '@deepseek-ai/cordis'
          || statement.body === undefined
          || !ts.isModuleBlock(statement.body)) continue
        for (const member of statement.body.statements) {
          if (!ts.isInterfaceDeclaration(member)) continue
          if (member.name.text === 'Context') {
            services.push(...this.collectServices(member, records))
          } else if (member.name.text === 'Events') {
            events.push(...this.collectEvents(member))
          }
        }
      }
    }
    const explicitServices = this.collectExplicitServices(records)

    const objects: ObjectModel[] = []
    const schemas: SchemaModel[] = []
    const seenBusinessSymbols = new Set<SymbolId>()
    for (const record of records) {
      const declaration = record.declaration
      if (!isTypeDeclaration(declaration)) continue
      if (this.registrationForFile(declaration.getSourceFile().fileName) === undefined) continue
      const symbol = this.resolveSymbol(record.symbol)
      const symbolId = this.symbolId(symbol)
      if (seenBusinessSymbols.has(symbolId)) continue
      const mode = typertMode(declaration)
      if (mode !== 'object' && mode !== 'schema') continue
      seenBusinessSymbols.add(symbolId)
      this.ensureDeclaration(symbol, declaration)
      const documentation = documentationOf(declaration)
      if (mode === 'object') {
        objects.push({
          ...documentation,
          export: record.model,
          symbol: symbolId,
          passing: 'reference',
        })
      } else {
        schemas.push({
          ...documentation,
          export: record.model,
          symbol: symbolId,
          type: this.referenceNode(symbol, declaration),
        })
      }
    }

    return {
      name: registration.name,
      root: slash(relative(this.root, registration.root)),
      exports: records.map(record => record.model)
        .sort((left, right) => left.subpath.localeCompare(right.subpath) || left.name.localeCompare(right.name)),
      services: uniqueBy([...explicitServices, ...services], service => service.key)
        .sort((left, right) => left.key.localeCompare(right.key)),
      events: uniqueBy(events, event => event.name).sort((left, right) => left.name.localeCompare(right.name)),
      objects: objects.sort((left, right) => left.export.name.localeCompare(right.export.name)),
      schemas: schemas.sort((left, right) => left.export.name.localeCompare(right.export.name)),
      invocations: this.face === 'host'
        ? this.collectInvocations(registration, reachable).sort((left, right) => left.id.localeCompare(right.id))
        : [],
    }
  }

  private collectExports(registration: PackageRegistration): ExportRecord[] {
    const targets = packageExportTargets(registration.manifest)
      .filter(([subpath]) => registration.exportSubpaths === undefined
        || registration.exportSubpaths.includes(subpath))
    const records: ExportRecord[] = []
    for (const [subpath, target] of targets) {
      if (target.includes('*') || subpath === './package.json'
        || subpath === './typert' || subpath === './client/typert' || subpath === './remote'
        // Data exports (bundle patch lists, JSON manifests) carry no TypeScript API.
        || target.endsWith('.json') || target.endsWith('.yml') || target.endsWith('.yaml')) continue
      const sourcePath = sourcePathForExport(registration.root, target)
      const sourceFile = this.sourceFiles.get(realPath(sourcePath))
      if (sourceFile === undefined) {
        throw new TypertAnalysisError(
          `typert(${this.face}): ${registration.name} export ${subpath} resolves to missing source ${sourcePath}`,
        )
      }
      const moduleSymbol = this.checker.getSymbolAtLocation(sourceFile)
      if (moduleSymbol === undefined) continue
      for (const exported of this.checker.getExportsOfModule(moduleSymbol)) {
        const symbol = this.resolveSymbol(exported)
        const declaration = preferredDeclaration(symbol) as ts.Declaration
        const aliases = exported === symbol || exported.name === symbol.name
          ? [exported.name]
          : [exported.name, symbol.name]
        records.push({
          model: {
            subpath,
            name: exported.name,
            symbol: this.symbolId(symbol),
            aliases,
          },
          symbol,
          declaration,
          sourceFile,
        })
      }
    }
    const unique = uniqueBy(records, record => `${record.model.subpath}\0${record.model.name}`)
    this.collectCrossFaceReExports(registration, unique)
    return unique
  }

  private collectCrossFaceReExports(
    registration: PackageRegistration,
    records: readonly ExportRecord[],
  ): void {
    const publicSymbols = new Set(records.map(record => record.symbol))
    const entryFiles = uniqueBy(records, record => record.sourceFile.fileName).map(record => record.sourceFile)
    for (const sourceFile of this.reachableFiles(registration, entryFiles)) {
      for (const statement of sourceFile.statements) {
        if (!ts.isExportDeclaration(statement)
          || statement.moduleSpecifier === undefined
          || !ts.isStringLiteral(statement.moduleSpecifier)) continue
        const module = moduleIdentity(statement.moduleSpecifier.text)
        if (module === undefined) continue
        const toFace = this.allRegistrations
          .find(candidate => candidate.name === module.package && candidate.face !== this.face)?.face
        if (toFace === undefined) continue

        if (statement.exportClause !== undefined && ts.isNamespaceExport(statement.exportClause)) {
          const namespace = this.resolveSymbol(
            this.checker.getSymbolAtLocation(statement.exportClause.name) as ts.Symbol,
          )
          if (publicSymbols.has(namespace)) {
            this.fail(statement.exportClause, 'cross-face namespace re-exports are not supported')
          }
          continue
        }

        const exports = statement.exportClause === undefined
          ? this.moduleExports(statement.moduleSpecifier)
            .map(symbol => ({ symbol: this.resolveSymbol(symbol), requestedName: symbol.name, site: statement }))
          : statement.exportClause.elements.map(element => ({
            symbol: this.resolveSymbol(this.checker.getSymbolAtLocation(element.name) as ts.Symbol),
            requestedName: element.propertyName?.text ?? element.name.text,
            site: element,
          }))
        for (const exported of exports) {
          if (!publicSymbols.has(exported.symbol)) continue
          const name = this.packageExportName(module, exported.symbol, toFace, exported.requestedName)
          if (name === undefined) {
            this.fail(
              exported.site,
              `cross-face re-export ${exported.requestedName} is not exported by ${module.package} at ${module.subpath}`,
            )
          }
          this.recordCrossFaceLink(registration.name, toFace, module, name)
        }
      }
    }
  }

  private moduleExports(moduleSpecifier: ts.StringLiteral): ts.Symbol[] {
    /* v8 ignore next -- a semantically valid export declaration from a resolved module always has a module symbol. */
    const moduleSymbol = this.checker.getSymbolAtLocation(moduleSpecifier) as ts.Symbol
    return this.checker.getExportsOfModule(moduleSymbol)
  }

  private reachableFiles(
    registration: PackageRegistration,
    entryFiles: readonly ts.SourceFile[],
  ): ts.SourceFile[] {
    const reachable = new Map<string, ts.SourceFile>()
    const queue = [...entryFiles]
    while (queue.length > 0) {
      const sourceFile = queue.shift() as ts.SourceFile
      const fileName = realPath(sourceFile.fileName)
      if (reachable.has(fileName) || !isWithin(fileName, registration.root)) continue
      reachable.set(fileName, sourceFile)
      for (const statement of sourceFile.statements) {
        if ((!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement))
          || statement.moduleSpecifier === undefined
          || !ts.isStringLiteral(statement.moduleSpecifier)) continue
        const resolvedPath = this.resolveImport(statement.moduleSpecifier.text, sourceFile.fileName)
        if (resolvedPath === undefined || !isWithin(resolvedPath, registration.root)) continue
        queue.push(this.sourceFiles.get(resolvedPath) as ts.SourceFile)
      }
    }
    return [...reachable.values()].sort((left, right) => left.fileName.localeCompare(right.fileName))
  }

  private resolveImport(specifier: string, fromFile: string): string | undefined {
    const resolved = ts.resolveModuleName(
      specifier,
      fromFile,
      this.program.getCompilerOptions(),
      this.host,
      this.host.getModuleResolutionCache?.(),
    ).resolvedModule
    return resolved === undefined ? undefined : realPath(resolved.resolvedFileName)
  }

  /**
   * Follow the import that names `symbol` at `site` through modules of the
   * referencing package until a package specifier appears. Each forwarding
   * module and requested export name pair is entered once; its explicit export
   * edges are tried before its star edges. A relative specifier that resolves
   * outside `from`, a namespace hop, or a module with no edge leading to a
   * package specifier yields undefined.
   */
  private packageImportOf(
    site: ReferenceSite,
    moduleSpecifier: string,
    symbol: ts.Symbol,
    from: PackageRegistration,
  ): PackageImport | undefined {
    const visited = new Map<string, Set<string>>()
    const walk = (sourceFile: ts.SourceFile, specifier: string, name: string): PackageImport | undefined => {
      const module = moduleIdentity(specifier)
      if (module !== undefined) return { module, name }
      const resolvedPath = this.resolveImport(specifier, sourceFile.fileName)
      if (resolvedPath === undefined || !isWithin(resolvedPath, from.root)) return undefined
      const names = visited.get(resolvedPath)
      if (names?.has(name)) return undefined
      if (names === undefined) visited.set(resolvedPath, new Set([name]))
      else names.add(name)
      const forward = this.sourceFiles.get(resolvedPath) as ts.SourceFile
      for (const edge of this.forwardedExports(forward, name, symbol)) {
        const found = walk(forward, edge.specifier, edge.name)
        if (found !== undefined) return found
      }
      return undefined
    }
    return walk(site.getSourceFile(), moduleSpecifier, authoredExportName(site, moduleSpecifier))
  }

  /** Export edges of `sourceFile` that carry `name`: explicit edges in source order, then star edges exporting `symbol`. */
  private forwardedExports(sourceFile: ts.SourceFile, name: string, symbol: ts.Symbol): ForwardedExport[] {
    const explicit: ForwardedExport[] = []
    const stars: ForwardedExport[] = []
    for (const statement of sourceFile.statements) {
      if (!ts.isExportDeclaration(statement)
        || (statement.exportClause === undefined && statement.moduleSpecifier === undefined)
        || (statement.exportClause !== undefined && ts.isNamespaceExport(statement.exportClause))) continue
      if (statement.exportClause === undefined) {
        const specifier = (statement.moduleSpecifier as ts.StringLiteral).text
        const exported = this.moduleExports(statement.moduleSpecifier as ts.StringLiteral)
          .find(candidate => candidate.name === name && this.resolveSymbol(candidate) === symbol)
        if (exported !== undefined) stars.push({ specifier, name })
        continue
      }
      const element = statement.exportClause.elements.find(candidate => candidate.name.text === name)
      if (element === undefined) continue
      if (statement.moduleSpecifier !== undefined) {
        explicit.push({ specifier: (statement.moduleSpecifier as ts.StringLiteral).text, name: element.propertyName?.text ?? name })
        continue
      }
      const binding = importBindingOf(sourceFile, element.propertyName?.text ?? name)
      if (binding?.name !== undefined) explicit.push({ specifier: binding.specifier, name: binding.name })
    }
    return [...explicit, ...stars]
  }

  private collectServices(
    context: ts.InterfaceDeclaration,
    records: readonly ExportRecord[],
  ): ServiceModel[] {
    const bySymbol = new Map<SymbolId, ExportRecord[]>()
    for (const record of records) {
      const id = this.symbolId(record.symbol)
      const matches = bySymbol.get(id) ?? []
      matches.push(record)
      bySymbol.set(id, matches)
    }
    const result: ServiceModel[] = []
    for (const member of context.members) {
      if (!ts.isPropertySignature(member) || member.type === undefined) continue
      // An OPTIONAL key is not a service: `X | undefined` and `key?: X` both mark
      // a value the launcher or boot code installs before the tree mounts (a root
      // accessor, an environment snapshot), which no plugin provides and no
      // consumer can reach with `inject`. Describing one as a service would answer
      // "add the plugin that provides it" for a key where no such plugin exists.
      if (member.questionToken !== undefined
        || (ts.isUnionTypeNode(member.type)
          && member.type.types.some(node => node.kind === ts.SyntaxKind.UndefinedKeyword))) continue
      const authoredSymbol = this.symbolAtType(member.type)
      if (authoredSymbol === undefined) continue
      const authoredSymbolId = this.symbolId(authoredSymbol)
      const exported = bySymbol.get(authoredSymbolId)?.find(record => record.model.name === authoredSymbol.name)
        ?? bySymbol.get(authoredSymbolId)?.find(record => record.model.name !== 'default')
        ?? bySymbol.get(authoredSymbolId)?.[0]
      if (exported === undefined) continue
      let symbol = authoredSymbol
      let declaration = preferredDeclaration(symbol)
      const aliases = new Set<ts.Symbol>()
      while (declaration !== undefined && ts.isTypeAliasDeclaration(declaration)) {
        if (aliases.has(symbol)) break
        aliases.add(symbol)
        const target = this.symbolAtType(declaration.type)
        if (target === undefined) break
        symbol = target
        declaration = preferredDeclaration(symbol)
      }
      if (declaration === undefined || (!ts.isClassDeclaration(declaration) && !ts.isInterfaceDeclaration(declaration))) {
        this.fail(member, `service ${memberName(member.name)} does not resolve to an exported class or interface`)
      }
      const memberOwner = this.registrationForFile(member.getSourceFile().fileName)
      const declarationOwner = this.registrationForFile(declaration.getSourceFile().fileName)
      if (memberOwner?.name !== declarationOwner?.name) continue
      const symbolId = this.symbolId(symbol)
      const model = this.ensureDeclaration(symbol, declaration)
      const exposed = model.members
        .filter(exposableMember)
        .map(publicMember => publicMember.id)
      result.push({
        ...documentationOf(declaration),
        key: memberName(member.name),
        symbol: symbolId,
        export: exported.model,
        members: exposed,
        location: this.location(member),
      })
    }
    return result
  }

  private collectExplicitServices(records: readonly ExportRecord[]): ServiceModel[] {
    const result: ServiceModel[] = []
    const seen = new Set<SymbolId>()
    for (const record of records) {
      const tag = typertServiceTag(record.declaration)
      if (tag === undefined) continue
      const words = (ts.getTextOfJSDocComment(tag.comment) ?? '').trim().split(/\s+/)
      if (words.length !== 2 || !isRemoteSegment(words[1] ?? '')) {
        this.fail(tag, '@typert service requires exactly one nonempty Cordis service key without "/"')
      }
      if (!ts.isClassDeclaration(record.declaration)) {
        this.fail(record.declaration, '@typert service requires an exported class')
      }
      const symbol = this.resolveSymbol(record.symbol)
      const symbolId = this.symbolId(symbol)
      if (seen.has(symbolId)) continue
      seen.add(symbolId)
      const model = this.ensureDeclaration(symbol, record.declaration)
      result.push({
        ...documentationOf(record.declaration),
        key: words[1] as string,
        symbol: symbolId,
        export: record.model,
        members: model.members.filter(exposableMember).map(member => member.id),
        location: this.location(record.declaration),
      })
    }
    return result
  }

  private collectInvocations(
    registration: PackageRegistration,
    reachable: readonly ts.SourceFile[],
  ): InvocationModel[] {
    const result: InvocationModel[] = []
    for (const sourceFile of reachable) {
      for (const statement of sourceFile.statements) {
        if (!ts.isClassDeclaration(statement)) continue
        const marked = statement.members.flatMap((member) => {
          const invocation = this.remoteMarker(member)
          if (invocation === undefined) return []
          if (!ts.isMethodDeclaration(member)) {
            this.fail(member, 'Remote decorators require a public instance method')
          }
          return [{ method: member, invocation }]
        })
        const first = marked[0]
        if (first === undefined) continue
        const binding = this.gatewayBinding(statement)
        if (binding === undefined) {
          this.fail(
            first.method,
            'Remote methods require TypertRemoteService or readonly typertGateway = bindTypertRemote(this, serviceKey)',
          )
        }
        for (const { method, invocation } of marked) {
          result.push(this.invocationModel(registration, binding, method, invocation))
        }
      }
    }
    return result
  }

  private invocationModel(
    registration: PackageRegistration,
    binding: GatewayBinding,
    method: ts.MethodDeclaration,
    invocation:
      | { readonly kind: 'direct'; readonly exportName?: string; readonly mode?: 'stream' }
      | { readonly kind: 'context'; readonly context: string; readonly exportName?: string },
  ): InvocationModel {
    if (visibilityOf(method) !== 'public' || hasModifier(method, ts.SyntaxKind.StaticKeyword)) {
      this.fail(method, 'Remote decorators require a public instance method')
    }
    if (hasModifier(method, ts.SyntaxKind.AbstractKeyword) || method.body === undefined) {
      this.fail(method, 'Remote methods must have a concrete implementation')
    }
    if (!ts.isIdentifier(method.name)) {
      this.fail(method, 'Remote method names must be identifiers')
    }
    if ((method.typeParameters?.length ?? 0) > 0) {
      this.fail(method, 'generic Remote methods are not supported')
    }
    const methodName = method.name.text
    const exportedMethod = invocation.exportName ?? methodName

    const lookups = this.lookupDeclarations()
    const lookupByHost = new Map(lookups.map(lookup => [lookup.hostSymbol, lookup]))
    const parameters: InvocationParameterModel[] = []
    let cancellation: InvocationModel['cancellation']
    const wires = new Set<string>()
    for (const [parameterIndex, parameter] of method.parameters.entries()) {
      if (!ts.isIdentifier(parameter.name)) {
        this.fail(parameter, 'Remote parameters must use identifier bindings')
      }
      if (parameter.dotDotDotToken !== undefined) this.fail(parameter, 'Remote parameters cannot be rest parameters')
      if (parameter.initializer !== undefined) this.fail(parameter, 'Remote parameters cannot have default values')
      if (parameter.name.text === 'this') this.fail(parameter, 'Remote methods cannot declare an explicit this parameter')
      const optional = parameter.questionToken !== undefined
      const authoredType = this.requiredType(parameter, parameter.type, 'parameter')
      const cancellationName = parameter.name.text === 'signal'
      const cancellationType = this.isGlobalAbortSignal(authoredType)
      if (cancellationName || cancellationType) {
        if (!cancellationName || !cancellationType) {
          this.fail(parameter, 'Remote cancellation must use a parameter named signal with the global AbortSignal type')
        }
        if (parameterIndex !== method.parameters.length - 1) {
          this.fail(parameter, 'Remote cancellation signal must be the final parameter')
        }
        cancellation = { parameter: 'signal' }
        continue
      }
      const hostSymbol = this.symbolAtType(authoredType)
      const lookup = hostSymbol === undefined ? undefined : lookupByHost.get(this.symbolId(hostSymbol))
      let modeled: InvocationParameterModel
      if (lookup !== undefined) {
        if (optional) this.fail(parameter, `lookup parameter for ${lookup.key} cannot be optional`)
        if (parameter.name.text !== lookup.key) {
          this.fail(parameter, `lookup parameter for ${lookup.key} must also be named ${lookup.key}`)
        }
        const boundary = this.remoteBoundary(
          lookup.wireType,
          `${registration.name}#${binding.namespace}/${exportedMethod}:${lookup.key}Id`,
          true,
        )
        modeled = {
          name: parameter.name.text,
          wire: `${lookup.key}Id`,
          source: 'lookup',
          lookup: lookup.key,
          boundary,
        }
      } else {
        if (hostSymbol !== undefined && this.isWorkspaceClass(hostSymbol)) {
          this.fail(parameter, `non-JSON class parameter ${hostSymbol.name} requires a TypertLookupMap entry`)
        }
        modeled = {
          name: parameter.name.text,
          wire: parameter.name.text,
          source: 'json',
          ...optional ? { optional: true as const } : {},
          boundary: this.remoteBoundary(
            authoredType,
            `${registration.name}#${binding.namespace}/${exportedMethod}:${parameter.name.text}`,
            false,
            'undefined',
            optional,
          ),
        }
      }
      if (wires.has(modeled.wire)) this.fail(parameter, `duplicate Remote wire field ${modeled.wire}`)
      wires.add(modeled.wire)
      parameters.push(modeled)
    }

    let receiver: InvocationModel['invocation'] = { kind: 'direct' }
    if (invocation.kind === 'context') {
      const context = this.contextDeclarations().get(invocation.context)
      if (context === undefined) {
        this.fail(method, `Remote Scope ${invocation.context} has no TypertContextMap entry`)
      }
      const wire = `${invocation.context}Id`
      if (wires.has(wire)) this.fail(method, `Remote Scope wire field ${wire} conflicts with a method parameter`)
      receiver = {
        kind: 'context',
        context: invocation.context,
        wire,
        boundary: this.remoteBoundary(
          context.wireType,
          `${registration.name}#${binding.namespace}/${exportedMethod}:${wire}`,
          true,
        ),
      }
    }

    let scope: InvocationModel['scope']
    if (invocation.kind === 'direct') {
      const lookupParameters = parameters.filter(parameter => parameter.source === 'lookup')
      const parameter = lookupParameters.length === 1 ? lookupParameters[0] : undefined
      const context = parameter?.lookup === undefined
        ? undefined
        : this.contextDeclarations().get(parameter.lookup)
      if (parameter !== undefined && context !== undefined) {
        const contextBoundary = this.remoteBoundary(
          context.wireType,
          `${registration.name}#${binding.namespace}/${exportedMethod}:scope:${context.key}`,
          true,
        )
        if (contextBoundary.typeSymbol !== parameter.boundary.typeSymbol) {
          this.fail(
            method,
            `Remote scope ${context.key} wire type ${contextBoundary.typeSymbol} does not match lookup wire type ${parameter.boundary.typeSymbol}`,
          )
        }
        scope = { context: context.key, wire: parameter.wire }
      }
    }

    const mode = invocation.kind === 'direct' ? invocation.mode : undefined
    const { result: resultType, uplink: uplinkType } = this.remoteResultType(method, mode)
    const uplink: InvocationModel['uplink'] = uplinkType === undefined
      ? undefined
      : {
        boundary: this.remoteBoundary(
          uplinkType,
          `${registration.name}#${binding.namespace}/${exportedMethod}:uplink`,
          false,
          'undefined',
        ),
      }
    return {
      id: `${registration.name}#${binding.namespace}/${exportedMethod}`,
      service: binding.service,
      namespace: binding.namespace,
      method: exportedMethod,
      ...(exportedMethod === methodName ? {} : { implementation: methodName }),
      ...(mode === undefined ? {} : { mode }),
      invocation: receiver,
      ...(scope === undefined ? {} : { scope }),
      parameters,
      ...(uplink === undefined ? {} : { uplink }),
      ...(cancellation === undefined ? {} : { cancellation }),
      result: this.remoteBoundary(
        resultType,
        `${registration.name}#${binding.namespace}/${exportedMethod}:result`,
        false,
        'undefined-or-void',
        false,
        mode === undefined,
      ),
      location: this.location(method.name),
    }
  }

  private gatewayBinding(declaration: ts.ClassDeclaration): GatewayBinding | undefined {
    const field = this.gatewayFieldBinding(declaration)
    const base = this.gatewayServiceBinding(declaration)
    if (field !== undefined && base !== undefined) {
      this.fail(field.site, 'TypertRemoteService subclasses must not declare a second typertRemote binding')
    }
    return field ?? base
  }

  private gatewayFieldBinding(declaration: ts.ClassDeclaration): GatewayBinding | undefined {
    const candidates = declaration.members.filter((member): member is ts.PropertyDeclaration =>
      ts.isPropertyDeclaration(member) && memberName(member.name) === 'typertRemote')
    const [property, duplicate] = candidates
    if (property === undefined) return undefined
    if (duplicate !== undefined) this.fail(duplicate, 'Service has more than one typertGateway field')
    if (visibilityOf(property) !== 'public'
      || hasModifier(property, ts.SyntaxKind.StaticKeyword)
      || !hasModifier(property, ts.SyntaxKind.ReadonlyKeyword)) {
      this.fail(property, 'typertGateway must be a public readonly instance field')
    }
    if (property.initializer === undefined
      || !ts.isCallExpression(property.initializer)
      || !this.isTypeMetaSymbol(property.initializer.expression, 'bindTypertRemote')) {
      this.fail(property, 'typertGateway must call bindTypertRemote()')
    }
    const call = property.initializer
    if (call.arguments.length < 2 || call.arguments.length > 3) {
      this.fail(call, 'bindTypertRemote() requires this, service key, and an optional options object')
    }
    if (call.arguments[0]?.kind !== ts.SyntaxKind.ThisKeyword) {
      this.fail(call.arguments[0] ?? call, 'bindTypertRemote() first argument must be this')
    }
    return this.gatewayBindingArguments(call, property)
  }

  private gatewayServiceBinding(declaration: ts.ClassDeclaration): GatewayBinding | undefined {
    const heritage = (declaration.heritageClauses ?? [])
      .filter(clause => clause.token === ts.SyntaxKind.ExtendsKeyword)
      .flatMap(clause => [...clause.types])
      .find(type => this.isTypeMetaSymbol(type.expression, 'TypertRemoteService'))
    if (heritage === undefined) return undefined

    const constructor = declaration.members.find(ts.isConstructorDeclaration)
    if (constructor?.body === undefined) {
      this.fail(heritage, 'TypertRemoteService subclasses must declare a constructor with super(ctx, serviceKey)')
    }
    const call = constructor.body.statements.flatMap((statement) => {
      if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) return []
      return statement.expression.expression.kind === ts.SyntaxKind.SuperKeyword ? [statement.expression] : []
    })[0]
    if (call === undefined) {
      this.fail(constructor, 'TypertRemoteService constructor must call super(ctx, serviceKey) directly')
    }
    if (call.arguments.length < 2 || call.arguments.length > 3) {
      this.fail(call, 'TypertRemoteService super() requires context, service key, and an optional options object')
    }
    return this.gatewayBindingArguments(call, heritage)
  }

  private gatewayBindingArguments(call: ts.CallExpression, site: ts.Node): GatewayBinding {
    const serviceArgument = call.arguments[1]
    if (serviceArgument === undefined) this.fail(call, 'Gateway service key must be a string literal')
    const service = stringLiteralValue(serviceArgument)
    if (service === undefined) this.fail(serviceArgument, 'Gateway service key must be a string literal')
    let namespace = service
    const options = call.arguments[2]
    if (options !== undefined) {
      if (!ts.isObjectLiteralExpression(options)) {
        this.fail(options, 'bindTypertRemote() options must be an object literal')
      }
      for (const propertyOption of options.properties) {
        if (!ts.isPropertyAssignment(propertyOption)
          || memberName(propertyOption.name) !== 'namespace') {
          this.fail(propertyOption, 'bindTypertRemote() only supports a namespace option')
        }
        const value = stringLiteralValue(propertyOption.initializer)
        if (value === undefined) this.fail(propertyOption.initializer, 'Gateway namespace must be a string literal')
        namespace = value
      }
    }
    if (!isRemoteSegment(service)) this.fail(serviceArgument, 'Gateway service key must contain only RPC endpoint segment characters')
    if (!isRemoteSegment(namespace)) this.fail(options ?? call, 'Gateway namespace must contain only RPC endpoint segment characters')
    return { service, namespace, site }
  }

  private remoteMarker(
    member: ts.ClassElement,
  ):
    | { readonly kind: 'direct'; readonly exportName?: string; readonly mode?: 'stream' }
    | { readonly kind: 'context'; readonly context: string; readonly exportName?: string }
    | undefined {
    let found:
      | { readonly kind: 'direct'; readonly exportName?: string; readonly mode?: 'stream' }
      | { readonly kind: 'context'; readonly context: string; readonly exportName?: string }
      | undefined
    for (const decorator of ts.canHaveDecorators(member) ? ts.getDecorators(member) ?? [] : []) {
      const expression = decorator.expression
      let marker: typeof found
      if (this.isTypeMetaSymbol(expression, 'Remote')) {
        marker = { kind: 'direct' }
      } else if (ts.isCallExpression(expression)
        && this.isTypeMetaSymbol(expression.expression, 'Remote')) {
        if (expression.arguments.length !== 1) this.fail(expression, 'Remote() requires one name or options object')
        const argument = expression.arguments[0]
        if (argument === undefined) this.fail(expression, 'Remote() requires one name or options object')
        const exportName = stringLiteralValue(argument)
        if (exportName !== undefined) {
          if (!isRemoteSegment(exportName)) {
            this.fail(argument, 'Remote() name must contain only RPC endpoint segment characters')
          }
          marker = { kind: 'direct', exportName }
        } else {
          if (!ts.isObjectLiteralExpression(argument) || argument.properties.length !== 1) {
            this.fail(argument, 'Remote() options must contain exactly mode: "stream"')
          }
          const [property] = argument.properties
          if (property === undefined) this.fail(argument, 'Remote() options must contain exactly mode: "stream"')
          const mode = ts.isPropertyAssignment(property) && memberName(property.name) === 'mode'
            ? stringLiteralValue(property.initializer)
            : undefined
          if (mode !== 'stream') this.fail(property, 'Remote() options must contain exactly mode: "stream"')
          marker = { kind: 'direct', mode }
        }
      } else if (ts.isCallExpression(expression)
        && this.isTypeMetaSymbol(expression.expression, 'RemoteScope')) {
        if (expression.arguments.length < 1 || expression.arguments.length > 2) {
          this.fail(expression, 'RemoteScope() requires a Context key and optional exported method name')
        }
        const context = stringLiteralValue(expression.arguments[0])
        if (context === undefined || !isRemoteSegment(context)) {
          this.fail(expression.arguments[0] ?? expression, 'RemoteScope() key must be a string literal containing only RPC endpoint segment characters')
        }
        const exportArgument = expression.arguments[1]
        const exportName = exportArgument === undefined ? undefined : stringLiteralValue(exportArgument)
        if (exportArgument !== undefined && (exportName === undefined || !isRemoteSegment(exportName))) {
          this.fail(exportArgument, 'RemoteScope() name must be a string literal containing only RPC endpoint segment characters')
        }
        marker = { kind: 'context', context, ...exportName === undefined ? {} : { exportName } }
      } else {
        continue
      }
      if (found !== undefined) this.fail(decorator, 'a method can have only one Remote invocation decorator')
      found = marker
    }
    return found
  }

  /**
   * The item types a Remote method's authored return type declares. Unary
   * methods unwrap `Promise<T>`; stream methods unwrap `Iterable<Out>`,
   * `AsyncIterable<Out>`, or the protocol's `RemoteStream<Out, In>`, whose
   * second type argument is the uplink item type unless it is `never`.
   */
  private remoteResultType(
    method: ts.MethodDeclaration,
    mode?: 'stream',
  ): { readonly result: ts.TypeNode; readonly uplink?: ts.TypeNode } {
    const authored = this.requiredType(method, method.type, 'return')
    if (ts.isTypeReferenceNode(authored)) {
      const symbol = this.checker.getSymbolAtLocation(authored.typeName)
      const resolved = symbol === undefined ? undefined : this.resolveSymbol(symbol)
      const declaration = resolved === undefined ? undefined : preferredDeclaration(resolved)
      const [result, uplink] = authored.typeArguments ?? []
      const arity = authored.typeArguments?.length ?? 0
      if (resolved !== undefined && declaration !== undefined && result !== undefined) {
        const standard = isStandardLibraryFile(declaration.getSourceFile().fileName)
        const wrappers = mode === undefined ? ['Promise'] : ['Iterable', 'AsyncIterable']
        if (standard && wrappers.includes(resolved.name) && arity === 1) return { result }
        if (mode !== undefined
          && resolved.name === 'RemoteStream'
          && this.isTypeMetaSymbol(authored.typeName, 'RemoteStream')
          && arity <= 2) {
          return uplink === undefined || this.isNeverType(uplink) ? { result } : { result, uplink }
        }
      }
    }
    if (mode !== undefined) {
      this.fail(method, 'stream Remote methods must return Iterable<Out>, AsyncIterable<Out>, or RemoteStream<Out, In>')
    }
    return { result: authored }
  }

  private isNeverType(type: ts.TypeNode): boolean {
    return (this.checker.getTypeFromTypeNode(type).flags & ts.TypeFlags.Never) !== 0
  }

  private isGlobalAbortSignal(type: ts.TypeNode): boolean {
    const symbol = this.symbolAtType(type)
    if (symbol?.name !== 'AbortSignal') return false
    return symbol.declarations?.some(declaration =>
      isStandardLibraryFile(declaration.getSourceFile().fileName)) === true
  }

  private lookupDeclarations(): readonly StaticLookupDeclaration[] {
    if (this.staticLookups !== undefined) return this.staticLookups
    const byKey = new Map<string, StaticLookupDeclaration>()
    const byHost = new Map<SymbolId, StaticLookupDeclaration>()
    for (const declaration of this.typeMetaMapMembers('TypertLookupMap')) {
      if (!ts.isPropertySignature(declaration) || declaration.type === undefined) {
        this.fail(declaration, 'TypertLookupMap entries must be required properties')
      }
      const key = memberName(declaration.name)
      if (!isRemoteSegment(key)) this.fail(declaration.name, 'TypertLookupMap key must contain only RPC endpoint segment characters')
      if (!ts.isTypeReferenceNode(declaration.type)
        || !this.isTypeMetaSymbol(declaration.type.typeName, 'TypertLookup')
        || declaration.type.typeArguments?.length !== 2) {
        this.fail(declaration.type, 'TypertLookupMap values must be TypertLookup<Host, Wire>')
      }
      const hostType = declaration.type.typeArguments[0]
      const wireType = declaration.type.typeArguments[1]
      if (hostType === undefined || wireType === undefined) {
        this.fail(declaration.type, 'TypertLookupMap values must be TypertLookup<Host, Wire>')
      }
      const host = this.symbolAtType(hostType)
      if (host === undefined) this.fail(hostType, 'TypertLookup Host must be a named type')
      const entry: StaticLookupDeclaration = {
        key,
        hostSymbol: this.symbolId(host),
        wireType,
        site: declaration,
      }
      if (byKey.has(key)) this.fail(declaration, `duplicate TypertLookupMap key ${key}`)
      if (byHost.has(entry.hostSymbol)) this.fail(declaration, `Host type ${host.name} has more than one Typert lookup`)
      byKey.set(key, entry)
      byHost.set(entry.hostSymbol, entry)
    }
    this.staticLookups = [...byKey.values()]
    return this.staticLookups
  }

  private contextDeclarations(): ReadonlyMap<string, StaticContextDeclaration> {
    if (this.staticContexts !== undefined) return this.staticContexts
    const result = new Map<string, StaticContextDeclaration>()
    for (const declaration of this.typeMetaMapMembers('TypertContextMap')) {
      if (!ts.isPropertySignature(declaration) || declaration.type === undefined) {
        this.fail(declaration, 'TypertContextMap entries must be required properties')
      }
      const key = memberName(declaration.name)
      if (!isRemoteSegment(key)) this.fail(declaration.name, 'TypertContextMap key must contain only RPC endpoint segment characters')
      if (!ts.isTypeReferenceNode(declaration.type)
        || !this.isTypeMetaSymbol(declaration.type.typeName, 'TypertContext')
        || declaration.type.typeArguments?.length !== 1) {
        this.fail(declaration.type, 'TypertContextMap values must be TypertContext<Wire>')
      }
      if (result.has(key)) this.fail(declaration, `duplicate TypertContextMap key ${key}`)
      const wireType = declaration.type.typeArguments[0]
      if (wireType === undefined) this.fail(declaration.type, 'TypertContextMap values must be TypertContext<Wire>')
      result.set(key, {
        key,
        wireType,
        site: declaration,
      })
    }
    this.staticContexts = result
    return result
  }

  private typeMetaMapMembers(name: 'TypertLookupMap' | 'TypertContextMap'): ts.TypeElement[] {
    const result: ts.TypeElement[] = []
    for (const sourceFile of this.program.getSourceFiles()) {
      for (const statement of sourceFile.statements) {
        if (!ts.isModuleDeclaration(statement)
          || !ts.isStringLiteral(statement.name)
          || statement.name.text !== '@deepseek-ai/dsh-typert-protocol'
          || statement.body === undefined
          || !ts.isModuleBlock(statement.body)) continue
        for (const nested of statement.body.statements) {
          if (ts.isInterfaceDeclaration(nested) && nested.name.text === name) result.push(...nested.members)
        }
      }
    }
    return result
  }

  private remoteBoundary(
    authoredType: ts.TypeNode,
    fallbackTypeSymbol: string,
    requireNamed: boolean,
    topLevelAbsence: 'reject' | 'undefined' | 'undefined-or-void' = 'reject',
    optional = false,
    allowBytes = false,
  ): RemoteBoundaryModel {
    const type = this.convertType(authoredType)
    const declaredType = this.checker.getTypeFromTypeNode(authoredType)
    // An optional parameter's authored node carries no `undefined`; the codec
    // still has to accept the omitted wire field the consumer sends.
    const resolvedType = optional
      ? this.checker.getNullableType(declaredType, ts.TypeFlags.Undefined)
      : declaredType
    const codecType = this.resolvedRemoteCodecType(authoredType, resolvedType, topLevelAbsence, allowBytes)
    const acceptsUndefined = topLevelAbsence !== 'reject' && this.includesRemoteAbsence(resolvedType)
    const rootSymbol = this.namedWorkspaceType(authoredType)
    const imports = new Map<SymbolId, RemoteTypeImportModel>()
    const visit = (node: ts.Node): void => {
      if ((ts.isTypeReferenceNode(node) || ts.isImportTypeNode(node))) {
        const symbol = ts.isTypeReferenceNode(node)
          ? this.checker.getSymbolAtLocation(node.typeName)
          : node.qualifier === undefined ? undefined : this.checker.getSymbolAtLocation(node.qualifier)
        if (symbol !== undefined) {
          const resolved = this.resolveSymbol(symbol)
          const declaration = preferredDeclaration(resolved)
          if (declaration !== undefined
            && !isStandardLibraryFile(declaration.getSourceFile().fileName)
            && this.registrationForFile(declaration.getSourceFile().fileName) !== undefined) {
            const imported = this.publicRemoteType(resolved, node)
            imports.set(imported.symbol, imported)
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(authoredType)
    if (rootSymbol !== undefined) {
      const imported = this.publicRemoteType(rootSymbol, authoredType)
      return {
        type,
        codecType,
        acceptsUndefined,
        typeSymbol: `${imported.specifier}#${imported.name}`,
        imports: [...imports.values()].sort((left, right) =>
          left.specifier.localeCompare(right.specifier) || left.name.localeCompare(right.name)),
      }
    }
    if (requireNamed) this.fail(authoredType, 'lookup and Context wire types must be named public types')
    return {
      type,
      codecType,
      acceptsUndefined,
      typeSymbol: fallbackTypeSymbol,
      imports: [...imports.values()].sort((left, right) =>
        left.specifier.localeCompare(right.specifier) || left.name.localeCompare(right.name)),
    }
  }

  /**
   * Project one authored Remote boundary through the complete face Program.
   * Consumer declarations retain the authored alias, while codecs use this
   * concrete graph so declaration-merged mapped and conditional types are
   * validated without teaching the compiler-independent emitter TypeScript's
   * type evaluator.
   */
  private resolvedRemoteCodecType(
    authoredType: ts.TypeNode,
    resolvedType: ts.Type,
    topLevelAbsence: 'reject' | 'undefined' | 'undefined-or-void',
    allowBytes: boolean,
  ): TypeNodeId {
    this.assertRemoteJsonType(
      resolvedType,
      authoredType,
      new Set(),
      topLevelAbsence !== 'reject',
      topLevelAbsence === 'undefined-or-void',
      allowBytes,
    )
    const completed = new Map<ts.Type, TypeNodeId>()
    const active = new Map<ts.Type, TypeNodeId>()
    const recursiveDeclarations = new Map<ts.Type, SymbolId>()
    const convert = (type: ts.Type): TypeNodeId => {
      const cached = completed.get(type)
      if (cached !== undefined) return cached
      const activeId = active.get(type)
      if (activeId !== undefined) {
        if (this.checker.isArrayType(type) || this.checker.isArrayLikeType(type)) {
          const element = this.checker.getIndexTypeOfType(type, ts.IndexKind.Number)
          const elementId = element === undefined ? undefined : active.get(element)
          if (element !== undefined && elementId !== undefined) {
            return this.addNode(authoredType, {
              kind: 'array',
              element: this.resolvedCycleReference(
                element,
                authoredType,
                elementId,
                recursiveDeclarations,
              ),
            })
          }
        }
        return this.resolvedCycleReference(type, authoredType, activeId, recursiveDeclarations)
      }
      const id = this.allocateNodeId(authoredType)
      active.set(type, id)
      try {
        const add = (model: TypeNodeInput): TypeNodeId => {
          this.nodes.set(id, { id, ...model })
          completed.set(type, id)
          return id
        }
        const flags = type.flags
        if (this.isRemoteByteArray(type)) {
          return add({ kind: 'reference', name: 'Uint8Array', target: { kind: 'standard', name: 'Uint8Array' }, arguments: [] })
        }
        if ((flags & ts.TypeFlags.Any) !== 0) return add({ kind: 'keyword', name: 'any' })
        if ((flags & ts.TypeFlags.Unknown) !== 0) return add({ kind: 'keyword', name: 'unknown' })
        if ((flags & ts.TypeFlags.Never) !== 0) return add({ kind: 'keyword', name: 'never' })
        if ((flags & ts.TypeFlags.String) !== 0) return add({ kind: 'keyword', name: 'string' })
        if ((flags & ts.TypeFlags.Number) !== 0) return add({ kind: 'keyword', name: 'number' })
        if ((flags & ts.TypeFlags.BigInt) !== 0) return add({ kind: 'keyword', name: 'bigint' })
        if ((flags & ts.TypeFlags.Boolean) !== 0) return add({ kind: 'keyword', name: 'boolean' })
        if ((flags & ts.TypeFlags.ESSymbol) !== 0) return add({ kind: 'keyword', name: 'symbol' })
        if ((flags & ts.TypeFlags.Undefined) !== 0) return add({ kind: 'keyword', name: 'undefined' })
        if ((flags & ts.TypeFlags.Void) !== 0) return add({ kind: 'keyword', name: 'void' })
        if ((flags & ts.TypeFlags.Null) !== 0) return add({ kind: 'literal', value: null, text: 'null' })
        if ((flags & ts.TypeFlags.StringLiteral) !== 0) {
          const value = (type as ts.StringLiteralType).value
          return add({ kind: 'literal', value, text: JSON.stringify(value) })
        }
        if ((flags & ts.TypeFlags.NumberLiteral) !== 0) {
          const value = (type as ts.NumberLiteralType).value
          return add({ kind: 'literal', value, text: String(value) })
        }
        if ((flags & ts.TypeFlags.BigIntLiteral) !== 0) {
          const value = (type as ts.BigIntLiteralType).value
          const text = `${value.negative ? '-' : ''}${value.base10Value}n`
          return add({ kind: 'literal', value: BigInt(`${value.negative ? '-' : ''}${value.base10Value}`), text })
        }
        if ((flags & ts.TypeFlags.BooleanLiteral) !== 0) {
          const value = (type as ts.Type & { readonly intrinsicName?: string }).intrinsicName === 'true'
          return add({ kind: 'literal', value, text: String(value) })
        }
        if (type.isUnionOrIntersection()) {
          return add({
            kind: (flags & ts.TypeFlags.Union) !== 0 ? 'union' : 'intersection',
            types: type.types.map(convert),
          })
        }
        if ((flags & ts.TypeFlags.TypeParameter) !== 0) {
          this.fail(authoredType, 'Remote codec contains an unresolved type parameter')
        }
        if ((flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)) === 0) {
          this.fail(
            authoredType,
            `Remote codec type ${this.checker.typeToString(type, authoredType, ts.TypeFormatFlags.NoTruncation)} has no concrete Zod projection`,
          )
        }
        if (this.checker.isTupleType(type)) {
          const reference = type as ts.TypeReference
          const target = reference.target as ts.TupleType
          const arguments_ = this.checker.getTypeArguments(reference)
          return add({
            kind: 'tuple',
            elements: arguments_.map((argument, index) => {
              const elementFlags = target.elementFlags[index] ?? ts.ElementFlags.Required
              return {
                type: (elementFlags & ts.ElementFlags.Rest) !== 0
                  ? this.addNode(authoredType, { kind: 'array', element: convert(argument) })
                  : convert(argument),
                optional: (elementFlags & ts.ElementFlags.Optional) !== 0,
                rest: (elementFlags & (ts.ElementFlags.Rest | ts.ElementFlags.Variadic)) !== 0,
              }
            }),
          })
        }
        if (this.checker.isArrayType(type) || this.checker.isArrayLikeType(type)) {
          const element = this.checker.getIndexTypeOfType(type, ts.IndexKind.Number)
          if (element === undefined) this.fail(authoredType, 'Remote codec array has no element type')
          return add({ kind: 'array', element: convert(element) })
        }
        if (type.getCallSignatures().length > 0 || type.getConstructSignatures().length > 0) {
          this.fail(authoredType, 'Remote codec cannot contain callable or constructable values')
        }
        const members: MemberModel[] = []
        for (const property of this.checker.getPropertiesOfType(type)) {
          const declaration = property.valueDeclaration ?? property.declarations?.[0]
          const propertyType = this.checker.getTypeOfSymbolAtLocation(property, declaration ?? authoredType)
          const symbolKey = property.getName()
          members.push({
            ...EMPTY_DOCUMENTATION,
            id: `${id}#${symbolKey}`,
            name: symbolKey,
            ...(symbolKey.startsWith('__@') ? { computed: 'symbol' as const } : {}),
            optional: (property.flags & ts.SymbolFlags.Optional) !== 0,
            readonly: declaration !== undefined && hasModifier(declaration, ts.SyntaxKind.ReadonlyKeyword),
            async: false,
            abstract: false,
            static: false,
            visibility: 'public',
            location: this.location(authoredType),
            text: '',
            kind: 'property',
            type: convert(propertyType),
          })
        }
        for (const [index, info] of this.checker.getIndexInfosOfType(type).entries()) {
          members.push({
            ...EMPTY_DOCUMENTATION,
            id: `${id}#index:${String(index)}`,
            name: '(index)',
            optional: false,
            readonly: info.isReadonly,
            async: false,
            abstract: false,
            static: false,
            visibility: 'public',
            location: this.location(authoredType),
            text: '',
            kind: 'index',
            signature: {
              typeParameters: [],
              parameters: [{
                name: 'key',
                binding: 'identifier',
                type: convert(info.keyType),
                optional: false,
                rest: false,
                receiver: false,
              }],
              returns: convert(info.type),
            },
          })
        }
        return add({ kind: 'object', members })
      } finally {
        active.delete(type)
      }
    }
    return convert(resolvedType)
  }

  private assertRemoteJsonType(
    type: ts.Type,
    site: ts.TypeNode,
    active: Set<ts.Type>,
    allowUndefined: boolean,
    allowVoid: boolean,
    allowBytes = false,
  ): void {
    const flags = type.flags
    if ((flags & ts.TypeFlags.Undefined) !== 0 && allowUndefined) return
    if ((flags & ts.TypeFlags.Void) !== 0 && allowVoid) return
    if ((flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) {
      this.fail(site, `Remote boundary contains unconstrained ${this.checker.typeToString(type)} data`)
    }
    if ((flags & (ts.TypeFlags.BigIntLike | ts.TypeFlags.ESSymbolLike | ts.TypeFlags.Undefined | ts.TypeFlags.Void)) !== 0) {
      this.fail(site, `Remote boundary contains non-JSON type ${this.checker.typeToString(type)}`)
    }
    if ((flags & (ts.TypeFlags.StringLike
      | ts.TypeFlags.NumberLike
      | ts.TypeFlags.BooleanLike
      | ts.TypeFlags.Null
      | ts.TypeFlags.Never)) !== 0) return
    if (this.isRemoteByteArray(type)) {
      if (allowBytes) return
      this.fail(site, 'Remote Uint8Array is only supported in unary results')
    }
    if (type.isUnion()) {
      for (const member of type.types) {
        this.assertRemoteJsonType(member, site, active, allowUndefined, allowVoid, allowBytes)
      }
      return
    }
    if (type.isIntersection()) {
      const material = type.types.filter(member => !this.isRemotePhantomConstraint(member))
      if (material.length === 0) this.fail(site, 'Remote boundary contains a symbol-only object')
      for (const member of material) this.assertRemoteJsonType(member, site, active, false, false, allowBytes)
      return
    }
    if ((flags & ts.TypeFlags.TypeParameter) !== 0) {
      this.fail(site, 'Remote boundary contains an unresolved type parameter')
    }
    if ((flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)) === 0) {
      this.fail(site, `Remote boundary contains non-JSON type ${this.checker.typeToString(type)}`)
    }
    const symbol = type.getSymbol()
    const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0]
    if (declaration !== undefined && (ts.isClassDeclaration(declaration) || ts.isClassExpression(declaration))) {
      this.fail(site, `Remote boundary contains class instance ${symbol?.name ?? this.checker.typeToString(type)}`)
    }
    if (type.getCallSignatures().length > 0 || type.getConstructSignatures().length > 0) {
      this.fail(site, 'Remote boundary contains callable or constructable data')
    }
    if (active.has(type)) return
    active.add(type)
    try {
      if (this.checker.isTupleType(type)) {
        const reference = type as ts.TypeReference
        const target = reference.target as ts.TupleType
        const arguments_ = this.checker.getTypeArguments(reference)
        arguments_.forEach((argument, index) => {
          const elementFlags = target.elementFlags[index] ?? ts.ElementFlags.Required
          this.assertRemoteJsonType(
            argument,
            site,
            active,
            (elementFlags & ts.ElementFlags.Optional) !== 0,
            false,
            allowBytes,
          )
        })
        return
      }
      if (this.checker.isArrayType(type) || this.checker.isArrayLikeType(type)) {
        const element = this.checker.getIndexTypeOfType(type, ts.IndexKind.Number)
        if (element === undefined) this.fail(site, 'Remote boundary array has no element type')
        this.assertRemoteJsonType(element, site, active, false, false, allowBytes)
        return
      }
      const properties = this.checker.getPropertiesOfType(type)
      if (properties.some(property => property.getName().startsWith('__@'))) {
        this.fail(site, 'Remote boundary contains a symbol-keyed property')
      }
      for (const property of properties) {
        const propertyDeclaration = property.valueDeclaration ?? property.declarations?.[0]
        const propertyType = this.checker.getTypeOfSymbolAtLocation(property, propertyDeclaration ?? site)
        this.assertRemoteJsonType(
          propertyType,
          site,
          active,
          (property.flags & ts.SymbolFlags.Optional) !== 0,
          false,
          allowBytes,
        )
      }
      for (const info of this.checker.getIndexInfosOfType(type)) {
        if ((info.keyType.flags & ts.TypeFlags.ESSymbolLike) !== 0) {
          this.fail(site, 'Remote boundary contains a symbol index signature')
        }
        this.assertRemoteJsonType(info.type, site, active, false, false, allowBytes)
      }
    } finally {
      active.delete(type)
    }
  }

  private isRemoteByteArray(type: ts.Type): boolean {
    const symbol = type.getSymbol()
    return symbol?.name === 'Uint8Array'
      && symbol.declarations?.some(declaration => isStandardLibraryFile(declaration.getSourceFile().fileName)) === true
  }

  private includesRemoteAbsence(type: ts.Type): boolean {
    if ((type.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void)) !== 0) return true
    return type.isUnion() && type.types.some(member => this.includesRemoteAbsence(member))
  }

  private isRemotePhantomConstraint(type: ts.Type): boolean {
    if ((type.flags & ts.TypeFlags.Unknown) !== 0) return true
    if ((type.flags & ts.TypeFlags.Any) !== 0 || (type.flags & ts.TypeFlags.Object) === 0) return false
    if (type.getCallSignatures().length > 0 || type.getConstructSignatures().length > 0) return false
    if (this.checker.getIndexInfosOfType(type).length > 0) return false
    return this.checker.getPropertiesOfType(type).every(property => property.getName().startsWith('__@'))
  }

  private resolvedCycleReference(
    type: ts.Type,
    site: ts.TypeNode,
    resolvedType: TypeNodeId,
    recursiveDeclarations: Map<ts.Type, SymbolId>,
  ): TypeNodeId {
    const symbol = type.aliasSymbol ?? type.getSymbol()
    if (symbol === undefined) this.fail(site, 'Remote codec contains an unnamed recursive type')
    const resolved = this.resolveSymbol(symbol)
    const declaration = preferredDeclaration(resolved)
    if (declaration === undefined || isStandardLibraryFile(declaration.getSourceFile().fileName)) {
      this.fail(site, `Remote codec recursive type ${resolved.name} has no workspace declaration`)
    }
    const owner = this.registrationForFile(declaration.getSourceFile().fileName)
    if (owner === undefined) this.fail(site, `Remote codec recursive type ${resolved.name} is not owned by this face`)
    let id = recursiveDeclarations.get(type)
    if (id === undefined) {
      id = `${this.symbolId(resolved)}#remote-codec:${resolvedType}`
      recursiveDeclarations.set(type, id)
      this.declarations.set(id, {
        ...EMPTY_DOCUMENTATION,
        id,
        package: owner.name,
        name: `${resolved.name}RemoteCodec`,
        kind: 'alias',
        abstract: false,
        exported: false,
        location: this.location(declaration),
        text: '',
        typeParameters: [],
        extends: [],
        implements: [],
        members: [],
        type: resolvedType,
      })
    }
    return this.addNode(site, {
      kind: 'reference',
      name: `${resolved.name}RemoteCodec`,
      target: { kind: 'declaration', symbol: id },
      arguments: [],
    })
  }

  private namedWorkspaceType(node: ts.TypeNode): ts.Symbol | undefined {
    if (!ts.isTypeReferenceNode(node) && !ts.isImportTypeNode(node)) return undefined
    const symbol = ts.isTypeReferenceNode(node)
      ? this.checker.getSymbolAtLocation(node.typeName)
      : node.qualifier === undefined ? undefined : this.checker.getSymbolAtLocation(node.qualifier)
    if (symbol === undefined) return undefined
    const resolved = this.resolveSymbol(symbol)
    const declaration = preferredDeclaration(resolved)
    if (declaration === undefined
      || isStandardLibraryFile(declaration.getSourceFile().fileName)
      || this.registrationForFile(declaration.getSourceFile().fileName) === undefined) return undefined
    return resolved
  }

  private publicRemoteType(symbol: ts.Symbol, site: ts.Node): RemoteTypeImportModel {
    const declaration = preferredDeclaration(symbol)
    if (declaration === undefined) this.fail(site, `type ${symbol.name} has no declaration`)
    const registration = this.registrationForFile(declaration.getSourceFile().fileName)
    if (registration === undefined) this.fail(site, `type ${symbol.name} is not owned by a workspace package`)
    const candidates: RemoteTypeImportModel[] = []
    for (const [subpath, target] of packageExportTargets(registration.manifest)) {
      if ((subpath === '.' && !PUBLIC_REMOTE_TYPE_ROOTS.has(registration.name))
        || subpath === './package.json' || subpath === './typert'
        || subpath === './client/typert' || subpath === './remote' || target.includes('*')) continue
      const sourceFile = this.sourceFiles.get(realPath(sourcePathForExport(registration.root, target)))
      if (sourceFile === undefined) continue
      const moduleSymbol = this.checker.getSymbolAtLocation(sourceFile)
      if (moduleSymbol === undefined) continue
      for (const exported of this.checker.getExportsOfModule(moduleSymbol)) {
        if (this.resolveSymbol(exported) !== symbol) continue
        candidates.push({
          symbol: this.symbolId(symbol),
          specifier: packageExportSpecifier(registration.name, subpath),
          name: exported.name,
        })
      }
    }
    const selected = candidates.sort((left, right) =>
      left.specifier.localeCompare(right.specifier) || left.name.localeCompare(right.name))[0]
    if (selected === undefined) {
      this.fail(site, `Remote boundary type ${symbol.name} must be exported from a public non-root type subpath`)
    }
    return selected
  }

  private isWorkspaceClass(symbol: ts.Symbol): boolean {
    const declaration = preferredDeclaration(symbol)
    return declaration !== undefined
      && ts.isClassDeclaration(declaration)
      && this.registrationForFile(declaration.getSourceFile().fileName) !== undefined
  }

  private isTypeMetaSymbol(node: ts.Node, name: string): boolean {
    const symbol = this.checker.getSymbolAtLocation(node)
    if (symbol === undefined) return false
    const resolved = this.resolveSymbol(symbol)
    if (resolved.name !== name) return false
    const declaration = preferredDeclaration(resolved)
    if (declaration === undefined) return false
    const registration = this.registrationForFile(declaration.getSourceFile().fileName)
    if (registration?.name === '@deepseek-ai/dsh-typert-protocol') return true
    for (let current: ts.Node | undefined = declaration; current !== undefined; current = optionalParent(current)) {
      if (ts.isModuleDeclaration(current)
        && ts.isStringLiteral(current.name)
        && current.name.text === '@deepseek-ai/dsh-typert-protocol') return true
    }
    return false
  }

  private validateInvocationIdentity(packages: readonly PackageModel[]): void {
    const endpoints = new Map<string, InvocationModel>()
    const ids = new Map<string, InvocationModel>()
    for (const invocation of packages.flatMap(packageModel => packageModel.invocations)) {
      const endpoint = `${invocation.namespace}/${invocation.method}`
      const existingEndpoint = endpoints.get(endpoint)
      if (existingEndpoint !== undefined) {
        throw new TypertAnalysisError(
          `typert(${this.face}): ${invocation.location.file}:${String(invocation.location.line)}:${String(invocation.location.column)}: Remote endpoint ${endpoint} conflicts with ${existingEndpoint.id}`,
        )
      }
      const existingId = ids.get(invocation.id)
      if (existingId !== undefined) {
        throw new TypertAnalysisError(
          `typert(${this.face}): ${invocation.location.file}:${String(invocation.location.line)}:${String(invocation.location.column)}: Remote invocation id ${invocation.id} conflicts with ${existingId.id}`,
        )
      }
      endpoints.set(endpoint, invocation)
      ids.set(invocation.id, invocation)
    }
  }

  private collectEvents(events: ts.InterfaceDeclaration): EventModel[] {
    const result: EventModel[] = []
    for (const member of events.members) {
      const documentation = documentationOf(member)
      const mode = documentation.tags.find(tag => tag.name === 'mode')?.comment?.trim()
      if (ts.isMethodSignature(member)) {
        const signature = this.signature(member, member.type)
        result.push({
          ...documentation,
          name: memberName(member.name),
          signature: this.addNode(member, { kind: 'function', signature }),
          text: memberText(member),
          ...(mode === undefined ? {} : { mode }),
          location: this.location(member),
        })
      } else if (ts.isPropertySignature(member) && member.type !== undefined) {
        result.push({
          ...documentation,
          name: memberName(member.name),
          signature: this.convertType(member.type),
          text: memberText(member),
          ...(mode === undefined ? {} : { mode }),
          location: this.location(member),
        })
      }
    }
    return result
  }

  private ensureDeclaration(
    symbol: ts.Symbol,
    selected: ts.ClassDeclaration | ts.InterfaceDeclaration | ts.TypeAliasDeclaration | ts.EnumDeclaration,
  ): TypeDeclarationModel {
    const resolved = this.resolveSymbol(symbol)
    const id = this.symbolId(resolved)
    const existing = this.declarations.get(id)
    if (existing !== undefined) return existing
    const declarationParts = (resolved.declarations as ts.Declaration[]).filter(isTypeDeclaration)
    if (declarationParts.length > 1 && !declarationParts.every(ts.isInterfaceDeclaration)) {
      this.fail(
        selected,
        `merged ${ts.SyntaxKind[selected.kind]} declaration ${resolved.name} is not supported`,
      )
    }
    if (selected.name === undefined) {
      this.fail(selected, `anonymous ${ts.SyntaxKind[selected.kind]} cannot be represented as a named type declaration`)
    }
    const owner = this.registrationForFile(selected.getSourceFile().fileName) as PackageRegistration

    this.declarationStates.add(id)
    if (declarationParts.length > 1) {
      const analyzedParts = declarationParts.map((declarationPart) => {
        const part = declarationPart as ts.InterfaceDeclaration
        const partOwner = this.registrationForFile(part.getSourceFile().fileName)
        if (partOwner === undefined) {
          this.fail(part, `merged interface ${resolved.name} contains a declaration outside this face`)
        }
        const typeParameters = this.typeParameters(part.typeParameters)
        const heritage = this.heritage(part)
        const members = this.members(part.members, id)
        return {
          typeParameters,
          heritage,
          members,
          model: {
            ...documentationOf(part),
            package: partOwner.name,
            location: this.location(part),
            typeParameters,
            extends: heritage.extends,
            members: members.map(member => member.id),
          },
        }
      })
      const parameters = this.mergeTypeParameters(analyzedParts.map(part => part.typeParameters), selected, resolved.name)
      const model: TypeDeclarationModel = {
        ...documentationOf(selected),
        id,
        package: owner.name,
        name: declarationName(selected),
        kind: 'interface',
        abstract: false,
        exported: hasModifier(selected, ts.SyntaxKind.ExportKeyword),
        location: this.location(selected),
        text: declarationText(selected),
        typeParameters: parameters,
        extends: analyzedParts.flatMap(part => part.heritage.extends),
        implements: [],
        members: analyzedParts.flatMap(part => part.members),
        parts: analyzedParts.map(part => part.model),
      }
      this.declarations.set(id, model)
      this.declarationStates.delete(id)
      return model
    }
    const parameters = ts.isEnumDeclaration(selected) ? [] : this.typeParameters(selected.typeParameters)
    const heritage = ts.isTypeAliasDeclaration(selected) || ts.isEnumDeclaration(selected)
      ? { extends: [] as TypeNodeId[], implements: [] as TypeNodeId[] }
      : this.heritage(selected)
    const kind = ts.isClassDeclaration(selected)
      ? 'class'
      : ts.isInterfaceDeclaration(selected)
        ? 'interface'
        : ts.isTypeAliasDeclaration(selected)
          ? 'alias'
          : 'enum'
    const model: TypeDeclarationModel = {
      ...documentationOf(selected),
      id,
      package: owner.name,
      name: declarationName(selected),
      kind,
      abstract: hasModifier(selected, ts.SyntaxKind.AbstractKeyword),
      exported: hasModifier(selected, ts.SyntaxKind.ExportKeyword),
      location: this.location(selected),
      text: declarationText(selected),
      typeParameters: parameters,
      extends: heritage.extends,
      implements: heritage.implements,
      members: ts.isTypeAliasDeclaration(selected) || ts.isEnumDeclaration(selected)
        ? []
        : this.members(selected.members, id),
      ...(ts.isTypeAliasDeclaration(selected) ? { type: this.convertType(selected.type) } : {}),
      ...(ts.isEnumDeclaration(selected) ? { enumMembers: this.enumMembers(selected) } : {}),
    }
    this.declarations.set(id, model)
    this.declarationStates.delete(id)
    return model
  }

  private enumMembers(declaration: ts.EnumDeclaration): EnumMemberModel[] {
    return declaration.members.map(member => ({
      ...documentationOf(member),
      name: memberName(member.name),
      ...(member.initializer === undefined ? {} : { initializer: member.initializer.getText() }),
      location: this.location(member),
    }))
  }

  private heritage(
    declaration: ts.ClassDeclaration | ts.InterfaceDeclaration,
  ): { extends: TypeNodeId[]; implements: TypeNodeId[] } {
    const result = { extends: [] as TypeNodeId[], implements: [] as TypeNodeId[] }
    for (const clause of declaration.heritageClauses ?? []) {
      const target = clause.token === ts.SyntaxKind.ExtendsKeyword ? result.extends : result.implements
      for (const type of clause.types) target.push(this.convertHeritage(type))
    }
    return result
  }

  private convertHeritage(node: ts.ExpressionWithTypeArguments): TypeNodeId {
    const symbol = this.checker.getSymbolAtLocation(node.expression) as ts.Symbol
    return this.addNode(node, {
      kind: 'reference',
      name: node.expression.getText(),
      target: this.targetForReference(this.resolveSymbol(symbol), node),
      arguments: node.typeArguments?.map(argument => this.convertType(argument)) ?? [],
    })
  }

  private members(
    members: ts.NodeArray<ts.TypeElement | ts.ClassElement>,
    ownerId: string,
  ): MemberModel[] {
    const result: MemberModel[] = []
    for (const member of members) {
      if (ts.isPropertyDeclaration(member)
        && memberName(member.name) === 'typertRemote'
        && member.initializer !== undefined
        && ts.isCallExpression(member.initializer)
        && this.isTypeMetaSymbol(member.initializer.expression, 'bindTypertRemote')) continue
      if (ts.isMethodDeclaration(member) && member.body !== undefined
        && members.some(candidate => candidate !== member
          && (ts.isMethodDeclaration(candidate) || ts.isMethodSignature(candidate))
          && memberName(candidate.name) === memberName(member.name)
          && (!ts.isMethodDeclaration(candidate) || candidate.body === undefined))) continue
      const visibility = visibilityOf(member)
      const isStatic = hasModifier(member, ts.SyntaxKind.StaticKeyword)
      if (visibility !== 'public' || isStatic || ts.isConstructorDeclaration(member)) continue
      const base = this.memberBase(member, ownerId, visibility, isStatic)
      if (ts.isPropertySignature(member) || ts.isPropertyDeclaration(member)) {
        const type = this.requiredType(member, member.type, 'property')
        result.push({ ...base, kind: 'property', type: this.convertType(type) })
      } else if (ts.isMethodSignature(member) || ts.isMethodDeclaration(member)) {
        result.push({ ...base, kind: 'method', signature: this.signature(member, member.type) })
      } else if (ts.isGetAccessorDeclaration(member)) {
        result.push({ ...base, kind: 'getter', signature: this.signature(member, member.type) })
      } else if (ts.isSetAccessorDeclaration(member)) {
        result.push({ ...base, kind: 'setter', signature: this.signature(member, member.type) })
      } else if (ts.isCallSignatureDeclaration(member)) {
        result.push({ ...base, kind: 'call', signature: this.signature(member, member.type) })
      } else if (ts.isConstructSignatureDeclaration(member)) {
        result.push({ ...base, kind: 'construct', signature: this.signature(member, member.type) })
      } else if (ts.isIndexSignatureDeclaration(member)) {
        result.push({ ...base, kind: 'index', signature: this.signature(member, member.type) })
      }
    }
    return result
  }

  private memberBase(
    member: ts.TypeElement | ts.ClassElement,
    ownerId: string,
    visibility: MemberVisibility,
    isStatic: boolean,
  ): MemberBase {
    const identity = member.name !== undefined
      ? this.memberIdentity(member.name)
      : {
        name: ts.isCallSignatureDeclaration(member)
          ? '(call)'
          : ts.isConstructSignatureDeclaration(member)
            ? '(construct)'
            : '(index)',
      }
    return {
      ...documentationOf(member),
      id: `${ownerId}#${identity.name}@${String(member.getStart())}`,
      ...identity,
      optional: 'questionToken' in member && member.questionToken !== undefined,
      readonly: hasModifier(member, ts.SyntaxKind.ReadonlyKeyword),
      async: hasModifier(member, ts.SyntaxKind.AsyncKeyword),
      abstract: hasModifier(member, ts.SyntaxKind.AbstractKeyword),
      static: isStatic,
      visibility,
      location: this.location(member),
      text: memberText(member),
    }
  }

  private memberIdentity(name: ts.PropertyName): Pick<MemberBase, 'name' | 'jsonName' | 'computed'> {
    if (!ts.isComputedPropertyName(name)) return { name: memberName(name) }
    const expression = name.expression
    if (ts.isStringLiteral(expression) || ts.isNumericLiteral(expression)
      || ts.isNoSubstitutionTemplateLiteral(expression)) {
      return { name: memberName(name), jsonName: expression.text }
    }
    const type = this.checker.getTypeAtLocation(expression)
    return {
      name: memberName(name),
      computed: (type.flags & ts.TypeFlags.UniqueESSymbol) !== 0 ? 'symbol' : 'dynamic',
    }
  }

  private signature(
    node: ts.SignatureDeclarationBase,
    explicitReturn: ts.TypeNode | undefined,
  ): SignatureModel {
    const parameters: ParameterModel[] = node.parameters.map(parameter => ({
      name: memberName(parameter.name),
      binding: ts.isIdentifier(parameter.name)
        ? 'identifier'
        : ts.isObjectBindingPattern(parameter.name)
          ? 'object'
          : 'array',
      type: this.convertType(this.requiredType(parameter, parameter.type, 'parameter')),
      optional: parameter.questionToken !== undefined || parameter.initializer !== undefined,
      rest: parameter.dotDotDotToken !== undefined,
      receiver: ts.isIdentifier(parameter.name) && parameter.name.text === 'this',
      ...(parameter.initializer === undefined ? {} : { initializer: parameter.initializer.getText() }),
    }))
    return {
      typeParameters: this.typeParameters(node.typeParameters),
      parameters,
      returns: ts.isSetAccessorDeclaration(node)
        ? this.addNode(node, { kind: 'keyword', name: 'void' })
        : this.convertType(this.requiredType(node, explicitReturn, 'return')),
    }
  }

  private typeParameters(
    parameters: ts.NodeArray<ts.TypeParameterDeclaration> | undefined,
  ): TypeParameterModel[] {
    return parameters?.map(parameter => ({
      id: `${this.locationKey(parameter)}#${parameter.name.text}`,
      name: parameter.name.text,
      const: hasModifier(parameter, ts.SyntaxKind.ConstKeyword),
      ...(parameter.constraint === undefined ? {} : { constraint: this.convertType(parameter.constraint) }),
      ...(parameter.default === undefined ? {} : { default: this.convertType(parameter.default) }),
      ...(hasModifier(parameter, ts.SyntaxKind.InKeyword) && hasModifier(parameter, ts.SyntaxKind.OutKeyword)
        ? { variance: 'in-out' as const }
        : hasModifier(parameter, ts.SyntaxKind.InKeyword)
          ? { variance: 'in' as const }
          : hasModifier(parameter, ts.SyntaxKind.OutKeyword)
            ? { variance: 'out' as const }
            : {}),
    })) ?? []
  }

  private mergeTypeParameters(
    parts: readonly (readonly TypeParameterModel[])[],
    site: ts.Node,
    declarationName: string,
  ): TypeParameterModel[] {
    const first = parts[0] as readonly TypeParameterModel[]
    return first.map((parameter, index) => {
      const peers = parts.map(part => part[index] as TypeParameterModel)
      const constraint = peers.find(peer => peer.constraint !== undefined)?.constraint
      const fallback = peers.find(peer => peer.default !== undefined)?.default
      const variances = [...new Set(peers.flatMap(peer => peer.variance === undefined ? [] : [peer.variance]))]
      if (variances.length > 1) {
        this.fail(site, `merged interface ${declarationName} has incompatible variance modifiers`)
      }
      return {
        id: parameter.id,
        name: parameter.name,
        const: peers.some(peer => peer.const),
        ...(constraint === undefined ? {} : { constraint }),
        ...(fallback === undefined ? {} : { default: fallback }),
        ...(variances[0] === undefined ? {} : { variance: variances[0] }),
      }
    })
  }

  private requiredType(
    owner: ts.Node,
    type: ts.TypeNode | undefined,
    purpose: 'property' | 'parameter' | 'return',
  ): ts.TypeNode {
    if (type !== undefined) return type
    if (this.mode === 'check') {
      this.fail(owner, `public ${purpose} is missing an explicit type annotation`)
    }
    const inferred = this.inferType(owner, purpose)
    const rendered = ts.createPrinter().printNode(ts.EmitHint.Unspecified, inferred, owner.getSourceFile())
    const position = annotationPosition(owner, purpose)
    this.queueEdit({ file: realPath(owner.getSourceFile().fileName), position, text: `: ${rendered}` })
    throw new SourceEditQueued()
  }

  private inferType(
    owner: ts.Node,
    purpose: 'property' | 'parameter' | 'return',
  ): ts.TypeNode {
    let type: ts.Type
    if (purpose === 'return') {
      const signature = this.checker.getSignatureFromDeclaration(owner as ts.SignatureDeclaration) as ts.Signature
      type = this.checker.getReturnTypeOfSignature(signature)
    } else {
      type = this.checker.getTypeAtLocation(owner)
    }
    return this.checker.typeToTypeNode(
      type,
      owner,
      ts.NodeBuilderFlags.NoTruncation | ts.NodeBuilderFlags.UseAliasDefinedOutsideCurrentScope,
    ) as ts.TypeNode
  }

  private convertType(node: ts.TypeNode): TypeNodeId {
    const id = this.allocateNodeId(node)
    const add = (model: TypeNodeInput): TypeNodeId => {
      this.nodes.set(id, { id, ...model })
      return id
    }

    const keyword = keywordName(node.kind)
    if (keyword !== undefined) return add({ kind: 'keyword', name: keyword })
    if (ts.isParenthesizedTypeNode(node)) {
      return add({ kind: 'parenthesized', type: this.convertType(node.type) })
    }
    if (ts.isLiteralTypeNode(node)) return add(literalModel(node))
    if (ts.isTypeReferenceNode(node)) {
      const symbol = this.checker.getSymbolAtLocation(node.typeName) as ts.Symbol
      return add({
        kind: 'reference',
        name: node.typeName.getText(),
        target: this.targetForReference(this.resolveSymbol(symbol), node),
        arguments: node.typeArguments?.map(argument => this.convertType(argument)) ?? [],
      })
    }
    if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node)) {
      return add({
        kind: ts.isUnionTypeNode(node) ? 'union' : 'intersection',
        types: node.types.map(type => this.convertType(type)),
      })
    }
    if (ts.isArrayTypeNode(node)) return add({ kind: 'array', element: this.convertType(node.elementType) })
    if (ts.isTupleTypeNode(node)) {
      return add({
        kind: 'tuple',
        elements: node.elements.map((element) => {
          const named = ts.isNamedTupleMember(element) ? element : undefined
          const raw = named?.type ?? element
          const optional = named?.questionToken !== undefined || ts.isOptionalTypeNode(raw)
          const rest = named?.dotDotDotToken !== undefined || ts.isRestTypeNode(raw)
          const type = ts.isOptionalTypeNode(raw) || ts.isRestTypeNode(raw) ? raw.type : raw
          return {
            ...(named === undefined ? {} : { name: named.name.text }),
            type: this.convertType(type),
            optional,
            rest,
          }
        }),
      })
    }
    if (ts.isTypeLiteralNode(node)) return add({ kind: 'object', members: this.members(node.members, id) })
    if (ts.isFunctionTypeNode(node)) {
      return add({ kind: 'function', signature: this.signature(node, node.type) })
    }
    if (ts.isConstructorTypeNode(node)) {
      return add({
        kind: 'constructor',
        abstract: hasModifier(node, ts.SyntaxKind.AbstractKeyword),
        signature: this.signature(node, node.type),
      })
    }
    if (ts.isIndexedAccessTypeNode(node)) {
      return add({
        kind: 'indexed-access',
        object: this.convertType(node.objectType),
        index: this.convertType(node.indexType),
      })
    }
    if (ts.isTypeOperatorNode(node)) {
      return add({
        kind: 'operator',
        operator: ts.tokenToString(node.operator) as TypeOperatorName,
        type: this.convertType(node.type),
      })
    }
    if (ts.isConditionalTypeNode(node)) {
      return add({
        kind: 'conditional',
        check: this.convertType(node.checkType),
        extends: this.convertType(node.extendsType),
        whenTrue: this.convertType(node.trueType),
        whenFalse: this.convertType(node.falseType),
      })
    }
    if (ts.isInferTypeNode(node)) {
      return add({ kind: 'infer', parameter: this.typeParameters(ts.factory.createNodeArray([node.typeParameter]))[0] as TypeParameterModel })
    }
    if (ts.isMappedTypeNode(node)) {
      const parameter = this.typeParameters(ts.factory.createNodeArray([node.typeParameter]))[0] as TypeParameterModel
      return add({
        kind: 'mapped',
        parameter,
        ...(node.nameType === undefined ? {} : { nameType: this.convertType(node.nameType) }),
        ...(node.type === undefined ? {} : { value: this.convertType(node.type) }),
        readonly: modifierMode(node.readonlyToken),
        optional: modifierMode(node.questionToken),
      })
    }
    if (ts.isTemplateLiteralTypeNode(node)) {
      return add({
        kind: 'template-literal',
        head: node.head.text,
        spans: node.templateSpans.map(span => ({ type: this.convertType(span.type), text: span.literal.text })),
      })
    }
    if (ts.isTypeQueryNode(node)) {
      return add({
        kind: 'type-query',
        expression: node.exprName.getText(),
        arguments: node.typeArguments?.map(argument => this.convertType(argument)) ?? [],
      })
    }
    if (ts.isImportTypeNode(node)) {
      const argument = node.argument as ts.LiteralTypeNode & { readonly literal: ts.StringLiteral }
      const symbol = node.qualifier === undefined ? undefined : this.checker.getSymbolAtLocation(node.qualifier)
      return add({
        kind: 'import-type',
        module: argument.literal.text,
        ...(node.qualifier === undefined ? {} : { qualifier: node.qualifier.getText() }),
        arguments: node.typeArguments?.map(argument => this.convertType(argument)) ?? [],
        typeof: node.isTypeOf,
        ...(node.attributes === undefined ? {} : { attributes: importTypeAttributesText(node) }),
        ...(symbol === undefined ? {} : { target: this.targetForReference(this.resolveSymbol(symbol), node) }),
      })
    }
    if (ts.isTypePredicateNode(node)) {
      return add({
        kind: 'predicate',
        asserts: node.assertsModifier !== undefined,
        parameter: node.parameterName.getText(),
        ...(node.type === undefined ? {} : { type: this.convertType(node.type) }),
      })
    }
    /* v8 ignore else -- every source TypeNode kind accepted by TypeScript is handled above; this arm keeps
     * future compiler kinds fail-loud. */
    if (ts.isThisTypeNode(node)) return add({ kind: 'this' })
    /* v8 ignore next -- paired with the exhaustive TypeNode guard above. */
    this.fail(node, `unsupported TypeScript type node ${ts.SyntaxKind[node.kind]}`)
  }

  private addNode(site: ts.Node, model: TypeNodeInput): TypeNodeId {
    const id = this.allocateNodeId(site)
    this.nodes.set(id, { id, ...model })
    return id
  }

  private referenceNode(symbol: ts.Symbol, site: ts.Node): TypeNodeId {
    return this.addNode(site, {
      kind: 'reference',
      name: symbol.name,
      target: { kind: 'declaration', symbol: this.symbolId(symbol) },
      arguments: [],
    })
  }

  private targetForReference(symbol: ts.Symbol, site: ReferenceSite): TypeTargetModel {
    const declaration = preferredDeclaration(symbol)
    /* v8 ignore next -- a symbol from a semantically valid source type reference always has a declaration. */
    if (declaration === undefined) this.fail(site, `type symbol ${symbol.name} has no declaration`)
    if (ts.isTypeParameterDeclaration(declaration)) {
      return {
        kind: 'type-parameter',
        parameter: `${this.locationKey(declaration)}#${declaration.name.text}`,
      }
    }
    if (isStandardLibraryFile(declaration.getSourceFile().fileName)) {
      return { kind: 'standard', name: symbol.name }
    }

    const moduleSpecifier = moduleSpecifierOf(site)
    const from = this.registrationForFile(site.getSourceFile().fileName) as PackageRegistration
    const owner = this.registrationForFile(declaration.getSourceFile().fileName)
    if (owner !== undefined) {
      if (owner.name !== from.name) {
        const imported = moduleSpecifier === undefined
          ? undefined
          : this.packageImportOf(site, moduleSpecifier, symbol, from)
        if (imported === undefined) {
          this.fail(site, `reference to ${symbol.name} crosses a package without an explicit package import`)
        }
        if (this.packageExportName(imported.module, symbol, owner.face, imported.name) === undefined) {
          this.fail(
            site,
            `package reference ${imported.name} is not exported by ${imported.module.package} at ${imported.module.subpath}`,
          )
        }
      }
      const typeDeclaration = declaration as ts.ClassDeclaration | ts.InterfaceDeclaration
        | ts.TypeAliasDeclaration | ts.EnumDeclaration
      if (!this.declarationStates.has(this.symbolId(symbol))) this.ensureDeclaration(symbol, typeDeclaration)
      return { kind: 'declaration', symbol: this.symbolId(symbol) }
    }

    const imported = moduleSpecifier === undefined
      ? undefined
      : this.packageImportOf(site, moduleSpecifier, symbol, from)
    const packageFaces = imported === undefined
      ? []
      : [...new Set(this.allRegistrations.filter(candidate => candidate.name === imported.module.package).map(candidate => candidate.face))]
    const otherFace = packageFaces.find(face => face !== this.face)
    if (otherFace !== undefined && imported !== undefined) {
      const { module } = imported
      const exportName = this.packageExportName(module, symbol, otherFace, imported.name)
      if (exportName === undefined) {
        this.fail(site, `cross-face reference ${imported.name} is not exported by ${module.package} at ${module.subpath}`)
      }
      this.recordCrossFaceLink(from.name, otherFace, module, exportName)
      return {
        kind: 'cross-face',
        face: otherFace,
        package: module.package,
        subpath: module.subpath,
        name: exportName,
      }
    }

    if (imported !== undefined) {
      return {
        kind: 'external',
        module: imported.module.package,
        subpath: imported.module.subpath,
        name: symbol.name,
      }
    }

    const external = externalModuleIdentityForFile(declaration.getSourceFile().fileName)
    if (external !== undefined) {
      return {
        kind: 'external',
        module: external.package,
        subpath: external.subpath,
        name: symbol.name,
      }
    }

    this.fail(site, `reference to ${symbol.name} crosses a package or face without an explicit import`)
  }

  private recordCrossFaceLink(
    fromPackage: string,
    toFace: TypertFace,
    module: ModuleIdentity,
    name: string,
  ): void {
    const link: CrossFaceLink = {
      fromFace: this.face,
      fromPackage,
      toFace,
      toPackage: module.package,
      subpath: module.subpath,
      name,
    }
    const key = [
      link.fromFace,
      link.fromPackage,
      link.toFace,
      link.toPackage,
      link.subpath,
      link.name,
    ].join('\0')
    this.crossFaceLinks.set(key, link)
  }

  private packageExportName(
    module: ModuleIdentity,
    symbol: ts.Symbol,
    face: TypertFace,
    requestedName: string,
  ): string | undefined {
    const registration = this.allRegistrations.find(candidate =>
      candidate.face === face && candidate.name === module.package)
    if (registration === undefined) return undefined
    const target = packageExportTargets(registration.manifest)
      .find(([subpath]) => subpath === module.subpath)?.[1]
    if (target === undefined) return undefined
    const sourceFile = this.sourceFiles.get(realPath(sourcePathForExport(registration.root, target))) as ts.SourceFile
    const moduleSymbol = this.checker.getSymbolAtLocation(sourceFile) as ts.Symbol
    const exported = this.checker.getExportsOfModule(moduleSymbol)
      .find(candidate => candidate.name === requestedName && this.resolveSymbol(candidate) === symbol)
    return exported?.name
  }

  private symbolAtType(node: ts.TypeNode): ts.Symbol | undefined {
    if (ts.isTypeReferenceNode(node)) {
      return this.resolveSymbol(this.checker.getSymbolAtLocation(node.typeName) as ts.Symbol)
    }
    const type = this.checker.getTypeAtLocation(node)
    const symbol = type.aliasSymbol ?? type.getSymbol()
    return symbol === undefined ? undefined : this.resolveSymbol(symbol)
  }

  private resolveSymbol(symbol: ts.Symbol): ts.Symbol {
    return (symbol.flags & ts.SymbolFlags.Alias) === 0 ? symbol : this.checker.getAliasedSymbol(symbol)
  }

  private symbolId(symbol: ts.Symbol): SymbolId {
    const declaration = preferredDeclaration(symbol)
    if (declaration === undefined) return `symbol:${symbol.name}`
    const location = this.location(declaration)
    return `${this.packageNameForFile(declaration.getSourceFile().fileName)}:${location.file}#${symbol.name}`
  }

  private registrationForFile(file: string): PackageRegistration | undefined {
    const path = realPath(file)
    return this.allRegistrations
      .find(registration => registration.face === this.face && isWithin(path, registration.root))
  }

  private packageNameForFile(file: string): string {
    const path = realPath(file)
    return this.allRegistrations.find(registration => isWithin(path, registration.root))?.name ?? '<external>'
  }

  private allocateNodeId(site: ts.Node): TypeNodeId {
    const location = this.locationKey(site)
    const ordinal = (this.nodeOrdinals.get(location) ?? 0) + 1
    this.nodeOrdinals.set(location, ordinal)
    return `type:${location}#${String(ordinal)}`
  }

  private locationKey(node: ts.Node): string {
    const location = this.location(node)
    return `${location.file}:${String(location.line)}:${String(location.column)}`
  }

  private location(node: ts.Node): SourceLocation {
    const sourceFile = node.getSourceFile()
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    return {
      file: slash(relative(this.root, sourceFile.fileName)),
      line: position.line + 1,
      column: position.character + 1,
    }
  }

  private fail(node: ts.Node, message: string): never {
    const location = this.location(node)
    throw new TypertAnalysisError(
      `typert(${this.face}): ${location.file}:${String(location.line)}:${String(location.column)}: ${message}`,
    )
  }
}

