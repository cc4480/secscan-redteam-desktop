/**
 * The Host-for-Client Remote contribution: declaration sources, the namespace
 * interfaces clients read, per-invocation boundary schemas and codecs, and the
 * import names the generated module uses.
 *
 * @module @deepseek-ai/dsh-typert-generator/emitter-remote
 */

import { Buffer } from 'node:buffer'
import { posix } from 'node:path'
import { quote, safeIdentifier } from './emitter-primitives.ts'
import { TypertEmitError } from './emitter-model.ts'
import type { BoundarySchemaRoot } from './emitter-schema.ts'
import type {
  InvocationModel,
  PackageModel,
  RemoteBoundaryModel,
  RemoteTypeImportModel,
  SymbolId,
} from './model.ts'

export function remoteDeclarationSource(packageModel: PackageModel, invocation: InvocationModel): string {
  const relativeSource = posix.relative(packageModel.root, invocation.location.file)
  if (relativeSource === '' || relativeSource === '..' || relativeSource.startsWith('../') || posix.isAbsolute(relativeSource)) {
    throw new TypertEmitError(
      `Remote declaration ${invocation.id} is outside its package root ${packageModel.root}`,
    )
  }
  return posix.join('..', relativeSource)
}

export function uniqueNamespaces(invocations: readonly InvocationModel[]): string[] {
  return [...new Set(invocations.map(invocation => invocation.namespace))].sort()
}

export function remoteNamespaceInterface(namespace: string): string {
  return `TypertRemoteNamespace$${Buffer.from(namespace, 'utf8').toString('hex')}`
}

export function invocationBoundaryRoots(invocations: readonly InvocationModel[]): BoundarySchemaRoot[] {
  const result: BoundarySchemaRoot[] = []
  for (const invocation of invocations) {
    if (invocation.invocation.kind === 'context') {
      result.push({ key: contextBoundaryKey(invocation), type: invocation.invocation.boundary.codecType })
    }
    invocation.parameters.forEach((parameter, index) => {
      result.push({ key: parameterBoundaryKey(invocation, index), type: parameter.boundary.codecType })
    })
    if (invocation.uplink !== undefined) {
      result.push({ key: uplinkBoundaryKey(invocation), type: invocation.uplink.boundary.codecType })
    }
    result.push({ key: resultBoundaryKey(invocation), type: invocation.result.codecType })
  }
  return result
}

export function contextBoundaryKey(invocation: InvocationModel): string {
  return `${invocation.id}:context`
}

export function uplinkBoundaryKey(invocation: InvocationModel): string {
  return `${invocation.id}:uplink`
}

export function parameterBoundaryKey(invocation: InvocationModel, index: number): string {
  return `${invocation.id}:parameter:${String(index)}`
}

export function resultBoundaryKey(invocation: InvocationModel): string {
  return `${invocation.id}:result`
}


export function strictCodec(boundary: RemoteBoundaryModel, schema: string, encoder?: string): string {
  return [
    '{',
    '  mode: \'strict\',',
    `  typeSymbol: ${quote(boundary.typeSymbol)},`,
    `  create: ${schema},`,
    ...(encoder === undefined ? [] : [
      `  decode: value => ${schema}().parse(value),`,
      `  encode: (value, writeBytes) => ${encoder}(value, writeBytes, [], new Map()),`,
    ]),
    '}',
  ].join('\n')
}


export function remoteImports(invocations: readonly InvocationModel[]): RemoteTypeImportModel[] {
  const imports = new Map<SymbolId, RemoteTypeImportModel>()
  const add = (boundary: RemoteBoundaryModel): void => {
    for (const imported of boundary.imports) {
      const current = imports.get(imported.symbol)
      if (current !== undefined
        && (current.specifier !== imported.specifier || current.name !== imported.name)) {
        throw new TypertEmitError(`typert Remote emitter: symbol ${imported.symbol} has inconsistent public imports`)
      }
      imports.set(imported.symbol, imported)
    }
  }
  for (const invocation of invocations) {
    if (invocation.invocation.kind === 'context') add(invocation.invocation.boundary)
    for (const parameter of invocation.parameters) add(parameter.boundary)
    if (invocation.uplink !== undefined) add(invocation.uplink.boundary)
    add(invocation.result)
  }
  return [...imports.values()].sort((left, right) =>
    left.specifier.localeCompare(right.specifier) || left.name.localeCompare(right.name))
}


export function allocateRemoteImportNames(imports: readonly RemoteTypeImportModel[]): ReadonlyMap<SymbolId, string> {
  const used = new Set([
    'RemoteDecoded',
    'RemoteResult',
    'RemoteStreamHandle',
    'TypertRemoteContribution',
    'TYPERT_REMOTE',
  ])
  const names = new Map<SymbolId, string>()
  for (const imported of imports) {
    const base = safeIdentifier(imported.name)
    let name = base
    let suffix = 2
    while (used.has(name)) name = `${base}$remote${String(suffix++)}`
    used.add(name)
    names.set(imported.symbol, name)
  }
  return names
}

export function packageExportSpecifier(packageName: string, subpath: string): string {
  return subpath === '.' ? packageName : `${packageName}${subpath.slice(1)}`
}

export function renderRemotePropertyName(name: string): string {
  return /^[$A-Z_a-z][$\w]*$/u.test(name) ? name : quote(name)
}
