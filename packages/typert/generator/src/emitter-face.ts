/**
 * Model-driven Typert artifact emitter. It consumes only FaceModel and
 * TypeGraph data; TypeScript compiler nodes are not part of this boundary.
 * @module @deepseek-ai/dsh-typert-generator/emitter-face
 */

import { GenMapping, addMapping, toEncodedMap } from '@jridgewell/gen-mapping'
import type {
  DocumentationModel,
  FaceModel,
  InvocationModel,
  MemberModel,
  PackageModel,
  SymbolId,
  TypeDeclarationModel,
} from './model.ts'
import { TypeGraphRenderer } from './renderer.ts'
import { containsBytes, indent, quote, safeIdentifier } from './emitter-primitives.ts'
import {
  allocateRemoteImportNames,
  contextBoundaryKey,
  invocationBoundaryRoots,
  packageExportSpecifier,
  parameterBoundaryKey,
  remoteDeclarationSource,
  remoteImports,
  remoteNamespaceInterface,
  renderRemotePropertyName,
  resultBoundaryKey,
  strictCodec,
  uniqueNamespaces,
  uplinkBoundaryKey,
} from './emitter-remote.ts'
import { SchemaEmitter } from './emitter-schema.ts'
import type { SchemaArtifact } from './emitter-schema.ts'
import { TypertEmitError } from './emitter-model.ts'
import type { ModelEmitResult, RemoteModelEmitResult } from './emitter-model.ts'

interface RuntimeMemberModel {
  readonly kind: MemberModel['kind']
  readonly name: string
  readonly signature: string
  readonly summary?: string
  readonly jsDoc?: string
}

interface RuntimeTypeModel {
  readonly name: string
  readonly declaration: string
}

interface RuntimeServiceModel extends DocumentationModel {
  readonly key: string
  readonly exportName: string
  readonly members: readonly RuntimeMemberModel[]
  readonly types: readonly RuntimeTypeModel[]
}

interface RuntimeEventModel extends DocumentationModel {
  readonly name: string
  readonly mode?: string
  readonly signature: string
}

interface RuntimeObjectModel extends DocumentationModel {
  readonly name: string
  readonly exportName: string
  readonly members: readonly RuntimeMemberModel[]
  readonly types: readonly RuntimeTypeModel[]
}

interface RuntimePackageModel {
  readonly services: readonly RuntimeServiceModel[]
  readonly events: readonly RuntimeEventModel[]
  readonly objects: readonly RuntimeObjectModel[]
}

function documentationLiteral(documentation: DocumentationModel): DocumentationModel {
  return {
    ...(documentation.description === undefined ? {} : { description: documentation.description }),
    ...(documentation.summary === undefined ? {} : { summary: documentation.summary }),
    tags: documentation.tags,
    ...(documentation.jsDoc === undefined ? {} : { jsDoc: documentation.jsDoc }),
  }
}

/** Emit generated runtime and type artifacts from one independently analyzed face. */
export class FaceModelEmitter {
  private readonly renderer: TypeGraphRenderer

  /**
   * Create an emitter for one face graph.
   * @param face - independently analyzed face.
   */
  constructor(private readonly face: FaceModel) {
    this.renderer = new TypeGraphRenderer(face.graph)
  }

  /**
   * Emit one modeled package.
   * @param packageName - exact package name in the face model.
   * @returns executable JavaScript and its precise declaration file.
   */
  emit(packageName: string): ModelEmitResult {
    const packageModel = this.face.packages.find(candidate => candidate.name === packageName)
    if (packageModel === undefined) {
      throw new TypertEmitError(`typert emitter(${this.face.face}): package ${packageName} is not modeled on this face`)
    }
    const schemas = new SchemaEmitter(
      this.renderer,
      packageModel.schemas,
      invocationBoundaryRoots(packageModel.invocations),
    )
    const schemaArtifact = schemas.emit()
    const runtimeModel = this.runtimeModel(packageModel)
    const js = this.renderJs(packageModel, schemaArtifact, runtimeModel)
    const dts = this.renderDts(packageModel, schemaArtifact)
    return {
      package: packageName,
      face: this.face.face,
      exports: packageModel.schemas.map(schema => schema.export.name),
      js,
      dts,
      ...(this.face.face === 'host' && packageModel.invocations.length > 0
        ? { remote: this.emitRemote(packageModel) }
        : {}),
    }
  }

  private runtimeModel(packageModel: PackageModel): RuntimePackageModel {
    const services = packageModel.services.map((service): RuntimeServiceModel => {
      const members = service.members.map(id => this.runtimeMember(this.renderer.member(id)))
      return {
        ...documentationLiteral(service),
        key: service.key,
        exportName: service.export.name,
        members,
        types: this.runtimeTypes(this.renderer.declarationClosureForMembers(service.members), service.symbol),
      }
    })
    const events = packageModel.events.map((event): RuntimeEventModel => {
      const node = this.renderer.node(event.signature)
      if (node.kind !== 'function') {
        throw new TypertEmitError(`typert emitter(${this.face.face}): event ${event.name} is not a function type`)
      }
      return {
        ...documentationLiteral(event),
        name: event.name,
        ...(event.mode === undefined ? {} : { mode: event.mode }),
        signature: `${quote(event.name)}${this.renderer.renderSignature(node.signature)}`,
      }
    })
    const objects = packageModel.objects.map((object): RuntimeObjectModel => {
      const declaration = this.renderer.declaration(object.symbol)
      return {
        ...documentationLiteral(object),
        name: declaration.name,
        exportName: object.export.name,
        members: declaration.members.map(member => this.runtimeMember(member)),
        types: this.runtimeTypes(this.renderer.declarationClosureForMembers(declaration.members.map(member => member.id)), declaration.id),
      }
    })
    return { services, events, objects }
  }

  private runtimeMember(member: MemberModel): RuntimeMemberModel {
    return {
      kind: member.kind,
      name: member.name,
      signature: this.renderer.renderMember(member, true),
      ...(member.summary === undefined ? {} : { summary: member.summary }),
      ...(member.jsDoc === undefined ? {} : { jsDoc: member.jsDoc }),
    }
  }

  private runtimeTypes(declarations: readonly TypeDeclarationModel[], root: SymbolId): RuntimeTypeModel[] {
    return declarations
      .filter(declaration => declaration.id !== root)
      .map(declaration => ({
        name: declaration.name,
        declaration: this.renderer.renderDeclaration(declaration.id),
      }))
      .sort((left, right) => left.name.localeCompare(right.name))
  }

  private renderJs(
    packageModel: PackageModel,
    schemas: SchemaArtifact,
    runtimeModel: RuntimePackageModel,
  ): string {
    const lines = [
      '/* Generated by @deepseek-ai/dsh-typert-generator from FaceModel — do not edit. */',
    ]
    if (schemas.definitions.length > 0) lines.push('import { z } from \'zod\'', '')
    lines.push(...schemas.definitions)
    if (schemas.definitions.length > 0) lines.push('')
    for (const schema of schemas.exports) lines.push(`export const ${schema.exportName} = ${schema.internalName}`)
    if (schemas.exports.length > 0) lines.push('')
    const model = JSON.stringify(runtimeModel, null, 2)
    lines.push('export const TYPERT = {')
    lines.push(`  package: ${quote(packageModel.name)},`)
    lines.push(`  face: ${quote(this.face.face)},`)
    lines.push('  schemas: [')
    for (const schema of schemas.exports) {
      lines.push(`    { name: ${quote(schema.exportName)}, create: ${schema.exportName} },`)
    }
    lines.push('  ],')
    lines.push('  invocations: [')
    for (const invocation of packageModel.invocations) {
      lines.push(`${indent(this.invocationLiteral(invocation, schemas), 4)},`)
    }
    lines.push('  ],')
    lines.push(`  model: ${indent(model, 2).trimStart()},`)
    lines.push('}')
    return `${lines.join('\n')}\n`
  }

  private renderDts(packageModel: PackageModel, schemas: SchemaArtifact): string {
    const imports = new Map<string, string[]>()
    for (const schema of schemas.exports) {
      const specifier = packageExportSpecifier(packageModel.name, schema.model.export.subpath)
      const names = imports.get(specifier) ?? []
      names.push(`${schema.model.export.name} as ${schema.exportName}$source`)
      imports.set(specifier, names)
    }
    const lines = [
      '/* Generated by @deepseek-ai/dsh-typert-generator from FaceModel — do not edit. */',
    ]
    if (schemas.exports.length > 0) lines.splice(1, 0, 'import type { z } from \'zod\'')
    for (const [specifier, names] of [...imports].sort(([left], [right]) => left.localeCompare(right))) {
      lines.push(`import type { ${names.sort().join(', ')} } from ${quote(specifier)}`)
    }
    lines.push('')
    for (const schema of schemas.exports) {
      lines.push(`export declare const ${schema.exportName}: () => z.ZodType<${schema.exportName}$source>`)
    }
    if (schemas.exports.length > 0) lines.push('')
    // The Loader validates and narrows this generated module boundary before
    // registration. Keeping the public declaration unknown prevents every
    // contributing business package from depending on the runtime registry.
    lines.push('export declare const TYPERT: unknown')
    return `${lines.join('\n')}\n`
  }

  private emitRemote(packageModel: PackageModel): RemoteModelEmitResult {
    const schemas = new SchemaEmitter(
      this.renderer,
      [],
      invocationBoundaryRoots(packageModel.invocations),
    ).emit()
    const lines = [
      '/* Generated by @deepseek-ai/dsh-typert-generator from the Host FaceModel — do not edit. */',
    ]
    if (schemas.definitions.length > 0) lines.push('import { z } from \'zod\'', '')
    lines.push(...schemas.definitions)
    if (schemas.definitions.length > 0) lines.push('')
    lines.push('export const TYPERT_REMOTE = {')
    lines.push(`  package: ${quote(packageModel.name)},`)
    lines.push('  descriptors: [')
    for (const invocation of packageModel.invocations) {
      lines.push(`${indent(this.invocationLiteral(invocation, schemas), 4)},`)
    }
    lines.push('  ],')
    lines.push('}')
    lines.push('')
    lines.push('export default TYPERT_REMOTE')
    const declaration = this.renderRemoteDts(packageModel)
    return {
      js: `${lines.join('\n')}\n`,
      ...declaration,
    }
  }

  private invocationLiteral(invocation: InvocationModel, schemas: SchemaArtifact): string {
    const lines = [
      '{',
      `  id: ${quote(invocation.id)},`,
      `  service: ${quote(invocation.service)},`,
      `  namespace: ${quote(invocation.namespace)},`,
      `  method: ${quote(invocation.method)},`,
    ]
    if (invocation.implementation !== undefined) {
      lines.push(`  implementation: ${quote(invocation.implementation)},`)
    }
    if (invocation.mode !== undefined) lines.push(`  mode: ${quote(invocation.mode)},`)
    if (invocation.invocation.kind === 'direct') {
      lines.push('  invocation: { kind: \'direct\' },')
    } else {
      lines.push('  invocation: {')
      lines.push('    kind: \'context\',')
      lines.push(`    context: ${quote(invocation.invocation.context)},`)
      lines.push(`    wire: ${quote(invocation.invocation.wire)},`)
      lines.push(`    codec: ${indent(strictCodec(
        invocation.invocation.boundary,
        schemas.boundary(contextBoundaryKey(invocation)),
      ), 4).trimStart()},`)
      lines.push('  },')
    }
    if (invocation.scope !== undefined) {
      lines.push('  scope: {')
      lines.push(`    context: ${quote(invocation.scope.context)},`)
      lines.push(`    wire: ${quote(invocation.scope.wire)},`)
      lines.push('  },')
    }
    lines.push('  parameters: [')
    invocation.parameters.forEach((parameter, index) => {
      lines.push('    {')
      lines.push(`      name: ${quote(parameter.name)},`)
      lines.push(`      wire: ${quote(parameter.wire)},`)
      lines.push(`      source: ${quote(parameter.source)},`)
      if (parameter.lookup !== undefined) lines.push(`      lookup: ${quote(parameter.lookup)},`)
      if (parameter.boundary.acceptsUndefined) lines.push('      acceptsUndefined: true,')
      lines.push(`      codec: ${indent(strictCodec(
        parameter.boundary,
        schemas.boundary(parameterBoundaryKey(invocation, index)),
      ), 6).trimStart()},`)
      lines.push('    },')
    })
    lines.push('  ],')
    if (invocation.uplink !== undefined) {
      lines.push('  uplink: {')
      lines.push(`    codec: ${indent(strictCodec(
        invocation.uplink.boundary,
        schemas.boundary(uplinkBoundaryKey(invocation)),
      ), 4).trimStart()},`)
      lines.push('  },')
    }
    if (invocation.cancellation !== undefined) {
      lines.push("  cancellation: { parameter: 'signal' },")
    }
    lines.push(`  result: ${indent(strictCodec(
      invocation.result,
      schemas.boundary(resultBoundaryKey(invocation)),
      schemas.encoder(resultBoundaryKey(invocation)),
    ), 2).trimStart()},`)
    lines.push(`  sourceLocation: ${JSON.stringify(invocation.location)},`)
    lines.push('}')
    return lines.join('\n')
  }

  private renderRemoteDts(packageModel: PackageModel): Pick<RemoteModelEmitResult, 'dts' | 'dtsMap'> {
    const imports = remoteImports(packageModel.invocations)
    const referenceNames = allocateRemoteImportNames(imports)
    const grouped = new Map<string, { readonly name: string; readonly local: string }[]>()
    for (const imported of imports) {
      const values = grouped.get(imported.specifier) ?? []
      values.push({
        name: imported.name,
        local: referenceNames.get(imported.symbol) as string,
      })
      grouped.set(imported.specifier, values)
    }
    // A stream method's Client signature returns the handle; `RemoteStream` names
    // what the Host method returns.
    const lines = [
      '/* Generated by @deepseek-ai/dsh-typert-generator from the Host FaceModel — do not edit. */',
      'import type {',
      '  RemoteResult,',
      ...packageModel.invocations.some(invocation => invocation.mode === 'stream') ? ['  RemoteStreamHandle,'] : [],
      '  TypertRemoteContribution,',
      '} from \'@deepseek-ai/dsh-typert-protocol\'',
    ]
    const sourceMap = new GenMapping({ file: 'typert.remote-client.d.ts' })
    for (const [specifier, values] of [...grouped].sort(([left], [right]) => left.localeCompare(right))) {
      const names = values.sort((left, right) => left.local.localeCompare(right.local)).map(value =>
        value.name === value.local ? value.name : `${value.name} as ${value.local}`)
      lines.push(`import type { ${names.join(', ')} } from ${quote(specifier)}`)
    }
    lines.push('')
    if (packageModel.invocations.some(invocation => containsBytes(this.renderer, invocation.result.codecType))) {
      lines.push('type RemoteDecoded<Value> = Value extends Uint8Array ? Uint8Array<ArrayBuffer>')
      lines.push('  : Value extends string | number | boolean | null | undefined ? Value')
      lines.push('  : { [Key in keyof Value]: RemoteDecoded<Value[Key]> }')
      lines.push('')
    }
    lines.push('declare module \'@deepseek-ai/dsh-typert-protocol\' {')
    const direct = packageModel.invocations.filter(invocation => invocation.invocation.kind === 'direct')
    const scoped = packageModel.invocations.filter(invocation =>
      invocation.invocation.kind === 'context' || invocation.scope !== undefined)
    if (direct.length > 0) {
      for (const namespace of uniqueNamespaces(direct)) {
        lines.push(`  interface ${remoteNamespaceInterface(namespace)} {`)
        for (const invocation of direct.filter(candidate => candidate.namespace === namespace)) {
          this.pushRemoteNamespaceSignature(lines, sourceMap, packageModel, invocation, referenceNames)
        }
        lines.push('  }')
      }
      lines.push('  interface TypertRemoteMap {')
      for (const invocation of direct) {
        this.pushRemoteSignature(lines, sourceMap, packageModel, invocation, referenceNames, false)
      }
      lines.push('  }')
      lines.push('  interface TypertRemoteNamespaceMap {')
      for (const namespace of uniqueNamespaces(direct)) {
        lines.push(`    ${quote(namespace)}: ${remoteNamespaceInterface(namespace)}`)
      }
      lines.push('  }')
    }
    if (scoped.length > 0) {
      lines.push('  interface TypertRemoteScopeMap {')
      for (const invocation of scoped) {
        this.pushRemoteSignature(lines, sourceMap, packageModel, invocation, referenceNames, true)
      }
      lines.push('  }')
    }
    lines.push('}')
    lines.push('')
    lines.push('export declare const TYPERT_REMOTE: TypertRemoteContribution')
    lines.push('export default TYPERT_REMOTE')
    lines.push('//# sourceMappingURL=typert.remote-client.d.ts.map')
    return {
      dts: `${lines.join('\n')}\n`,
      dtsMap: `${JSON.stringify(toEncodedMap(sourceMap))}\n`,
    }
  }

  private pushRemoteSignature(
    lines: string[],
    sourceMap: GenMapping,
    packageModel: PackageModel,
    invocation: InvocationModel,
    referenceNames: ReadonlyMap<SymbolId, string>,
    scoped: boolean,
  ): void {
    const signature = this.remoteSignature(invocation, referenceNames, scoped)
    const keyLength = signature.indexOf(': (')
    if (keyLength < 0) throw new TypertEmitError(`Remote signature ${invocation.id} has no property delimiter`)
    this.pushMappedRemoteSignature(lines, sourceMap, packageModel, invocation, signature, keyLength)
  }

  private pushRemoteNamespaceSignature(
    lines: string[],
    sourceMap: GenMapping,
    packageModel: PackageModel,
    invocation: InvocationModel,
    referenceNames: ReadonlyMap<SymbolId, string>,
  ): void {
    const key = renderRemotePropertyName(invocation.method)
    const signature = `${key}: ${this.remoteFunctionType(invocation, referenceNames, false)}`
    this.pushMappedRemoteSignature(lines, sourceMap, packageModel, invocation, signature, key.length)
  }

  private pushMappedRemoteSignature(
    lines: string[],
    sourceMap: GenMapping,
    packageModel: PackageModel,
    invocation: InvocationModel,
    signature: string,
    keyLength: number,
  ): void {
    lines.push(`    ${signature}`)
    const generatedLine = lines.length
    const source = remoteDeclarationSource(packageModel, invocation)
    addMapping(sourceMap, {
      generated: { line: generatedLine, column: 4 },
      source,
      original: { line: invocation.location.line, column: invocation.location.column - 1 },
      name: invocation.method,
    })
    addMapping(sourceMap, {
      generated: { line: generatedLine, column: 4 + keyLength },
    })
  }

  private remoteSignature(
    invocation: InvocationModel,
    referenceNames: ReadonlyMap<SymbolId, string>,
    scoped: boolean,
  ): string {
    const context = invocation.invocation.kind === 'context'
      ? invocation.invocation.context
      : invocation.scope?.context
    const key = scoped
      ? `${context as string}:${invocation.namespace}/${invocation.method}`
      : `${invocation.namespace}/${invocation.method}`
    return `${quote(key)}: ${this.remoteFunctionType(invocation, referenceNames, scoped)}`
  }

  private remoteFunctionType(
    invocation: InvocationModel,
    referenceNames: ReadonlyMap<SymbolId, string>,
    scoped: boolean,
  ): string {
    const parameters = invocation.parameters.filter(parameter =>
      !scoped || invocation.invocation.kind === 'context' || parameter.wire !== invocation.scope?.wire).map(parameter =>
      `${safeIdentifier(parameter.wire)}${parameter.optional === true ? '?' : ''}: ${this.renderer.renderType(parameter.boundary.type, referenceNames)}`)
    if (invocation.cancellation !== undefined) parameters.push('signal?: AbortSignal')
    const authoredResult = this.renderer.renderType(invocation.result.type, referenceNames)
    const result = containsBytes(this.renderer, invocation.result.codecType)
      ? `RemoteDecoded<${authoredResult}>`
      : authoredResult
    if (invocation.mode === 'stream') {
      const uplink = invocation.uplink === undefined
        ? 'never'
        : this.renderer.renderType(invocation.uplink.boundary.type, referenceNames)
      return `(${parameters.join(', ')}) => RemoteStreamHandle<${result}, ${uplink}>`
    }
    // The unary Client Remote face delivers the carrier's outcome, so every
    // generated consumer signature resolves to a result the caller reads.
    return `(${parameters.join(', ')}) => Promise<RemoteResult<${result}>>`
  }
}
