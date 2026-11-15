/** Compile the repository source roots and extract the persistence schema inventory. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { collectLogEvents } from './persistence-catalog-source.ts'
import { SchemaExtractor } from './persistence-schema-extractor.ts'
import { schemaEnvelope, schemaInventory, type RootInput } from './persistence-schema-inventory.ts'
import type { PersistenceSchemaInventory } from './persistence-schema-model.ts'
import { hostSourceFiles, validateReachableDeclarations } from './persistence-schema-program.ts'
import { PersistenceSchemaError, compare, diagnosticText, stringLiterals } from './persistence-schema-shared.ts'

/**
 * Extract every repository event, its complete envelope, and the Session header.
 * @param root - repository root, with source paths in tsconfig.host.json.
 * @returns canonical root fingerprints and all reachable type definitions.
 */
export function extractPersistenceSchema(root: string): PersistenceSchemaInventory {
  root = resolve(root)
  const events = collectLogEvents(root).sort((left, right) => compare(left.name, right.name))
  if (events.length === 0) throw new PersistenceSchemaError('persistence schema: no Session events were discovered')
  const filename = resolve(root, 'scripts/__persistence_schema_roots__.ts')
  const source = [
    "import type { SessionHeader, SessionEvent, SessionEventMap, SurfaceEventType } from '@deepseek-ai/dsh-session/types'",
    'export type HeaderRoot = SessionHeader',
    'export type SurfaceRoot = SurfaceEventType',
    'export type EventNamesRoot = keyof SessionEventMap',
    ...events.map((event, index) => `export type EventRoot${String(index)} = SessionEvent<${JSON.stringify(event.name)}>`),
    '',
  ].join('\n')
  const configPath = resolve(root, 'tsconfig.host.json')
  const config = ts.readConfigFile(configPath, file => readFileSync(file, 'utf8'))
  if (config.error !== undefined) throw new PersistenceSchemaError(diagnosticText(config.error))
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root)
  const configErrors = parsed.errors.filter(error => error.code !== 18003)
  if (configErrors.length > 0) throw new PersistenceSchemaError(configErrors.map(diagnosticText).join('\n'))
  const options: ts.CompilerOptions = {
    ...parsed.options,
    composite: false,
    incremental: false,
    noEmit: true,
    rootDir: root,
    noUnusedLocals: false,
    noUnusedParameters: false,
    // Reachable declaration-file errors must not become opaque any values.
    skipLibCheck: false,
    strict: true,
    exactOptionalPropertyTypes: true,
  }
  const host = ts.createCompilerHost(options)
  const originalGetSourceFile = host.getSourceFile.bind(host)
  host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) =>
    resolve(path) === filename
      ? ts.createSourceFile(filename, source, languageVersion, true)
      : originalGetSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile)
  const files = [...new Set([
    ...hostSourceFiles(root, configPath),
    ...events.map(event => resolve(root, event.source.slice(0, event.source.lastIndexOf(':')))),
  ])]
  const program = ts.createProgram({ rootNames: [filename, ...files], options, host })
  const rootSource = program.getSourceFile(filename)
  if (rootSource === undefined) throw new PersistenceSchemaError('persistence schema: compiler omitted the requested roots')
  const diagnostics = [
    ...program.getOptionsDiagnostics(), ...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics(rootSource),
  ]
  if (diagnostics.length > 0) throw new PersistenceSchemaError(diagnostics.map(diagnosticText).join('\n'))
  const checker = program.getTypeChecker()
  const declarations = new Map(rootSource.statements.filter(ts.isTypeAliasDeclaration)
    .map(declaration => [declaration.name.text, declaration]))
  const declaration = (name: string): ts.TypeAliasDeclaration => {
    const found = declarations.get(name)
    if (found === undefined) throw new PersistenceSchemaError(`persistence schema: missing compiler root ${name}`)
    return found
  }
  const eventNamesDeclaration = declaration('EventNamesRoot')
  const compiledEvents = stringLiterals(checker.getTypeFromTypeNode(eventNamesDeclaration.type), 'keyof SessionEventMap')
  const discoveredEvents = new Set(events.map(event => event.name))
  const omitted = [...compiledEvents].filter(name => !discoveredEvents.has(name))
  const uncompiled = [...discoveredEvents].filter(name => !compiledEvents.has(name))
  if (omitted.length > 0 || uncompiled.length > 0) {
    throw new PersistenceSchemaError(`persistence schema: compiler and source event discovery disagree; omitted: ${omitted.join(', ')}; uncompiled: ${uncompiled.join(', ')}`)
  }
  const surfaceDeclaration = declaration('SurfaceRoot')
  const surface = stringLiterals(checker.getTypeFromTypeNode(surfaceDeclaration.type), 'SurfaceEventType')
  for (const name of surface) {
    if (!events.some(event => event.name === name)) throw new PersistenceSchemaError(`persistence schema: surface event ${name} has no declaration`)
  }
  const header = declaration('HeaderRoot')
  const physicalFile = resolve(root, 'packages/session/session-persistence-jsonl/src/format.ts')
  const physical = program.getSourceFile(physicalFile)?.statements
    .filter((node): node is ts.InterfaceDeclaration | ts.TypeAliasDeclaration =>
      ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node))
    .filter(declaration => declaration.name.text === 'HeaderLine')
  if (physical?.length !== 1) throw new PersistenceSchemaError('persistence schema: expected one current JSONL HeaderLine declaration')
  const physicalHeader = physical[0] as ts.InterfaceDeclaration | ts.TypeAliasDeclaration
  const declarationSources = validateReachableDeclarations(program, root, [...declarations.values(), physicalHeader])
  const extraction = new SchemaExtractor(root, program, declarationSources)
  const roots: RootInput[] = [{
    key: 'SessionHeader',
    kind: 'header',
    node: extraction.convert(checker.getTypeFromTypeNode(header.type), header),
  }]
  roots.push({ key: 'JsonlHeaderLine', kind: 'header', node: extraction.convert(checker.getTypeAtLocation(physicalHeader), physicalHeader) })
  const envelopes: number[] = []
  for (const [index, event] of events.entries()) {
    const item = declaration(`EventRoot${String(index)}`)
    const node = extraction.convert(checker.getTypeFromTypeNode(item.type), item)
    roots.push({ key: `event:${event.name}`, kind: 'event', event: event.name, surface: surface.has(event.name), node })
    envelopes.push(schemaEnvelope(extraction, node, event.name))
  }
  roots.splice(2, 0, { key: 'SessionEventEnvelope', kind: 'envelope', node: extraction.union(envelopes) })
  return schemaInventory(extraction, roots)
}
