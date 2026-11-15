/** Fact assembly: the source-plane input the verifier reasons over. */

import { globSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import {
  CLIENT_MANIFEST_GLOB,
  CONFIG_GLOB,
  GATE,
  PLATFORM_SOURCE,
  PARSER_PRELOAD_SOURCE,
  STATIC_PRESET_SOURCE,
} from './verify-client-package-context.ts'
import {
  normalizePath,
  readClientDeclarations,
  type ClientDeclaration,
  type Manifest,
} from './verify-client-package-declarations.ts'
import { collectSourceFileUses } from './verify-client-package-source-uses.ts'
import { TypeScriptProject } from './ts-project.ts'
import type { ClientPackage, ClientPackageFacts } from './verify-client-package-violations.ts'

/**
 * Collect every fact the client package verifier checks.
 * @param root - Absolute repository root.
 * @returns Package modes, declarations, and the shell's module lists.
 */
export async function readFacts(root: string): Promise<ClientPackageFacts> {
  const { declarations: bareDeclarations, malformed } = readClientDeclarations(root)
  const staticLinkedPackages = await readStaticLinkedRoster(root)
  const project = new TypeScriptProject(root, 'client')
  const sourceFiles = project.sourceFiles()
  const declarations = bareDeclarations.map((declaration): ClientDeclaration => {
    const runtimeSourceUses = new Map<string, Set<string>>()
    const runtimeSourceSpecifiers = new Map<string, Set<string>>()
    const sourcePrefix = dirname(declaration.manifest) + '/src/'
    for (const sourceFile of sourceFiles) {
      if (sourceFile.isDeclarationFile) continue
      const file = project.relativePath(sourceFile)
      if (!file.startsWith(sourcePrefix)) continue
      for (const name of collectSourceFileUses(sourceFile, true, 'package')) {
        const locations = runtimeSourceUses.get(name) ?? new Set<string>()
        locations.add(file)
        runtimeSourceUses.set(name, locations)
      }
      for (const specifier of collectSourceFileUses(sourceFile, true, 'specifier')) {
        const locations = runtimeSourceSpecifiers.get(specifier) ?? new Set<string>()
        locations.add(file)
        runtimeSourceSpecifiers.set(specifier, locations)
      }
    }
    return {
      ...declaration,
      runtimeSourceUses: Object.fromEntries(
        [...runtimeSourceUses].sort(([left], [right]) => left.localeCompare(right))
          .map(([name, locations]) => [name, [...locations].sort()]),
      ),
      runtimeSourceSpecifiers: Object.fromEntries(
        [...runtimeSourceSpecifiers].sort(([left], [right]) => left.localeCompare(right))
          .map(([specifier, locations]) => [specifier, [...locations].sort()]),
      ),
    }
  })
  const byManifest = new Map(declarations.map(entry => [entry.manifest, entry]))
  const packages: ClientPackage[] = []

  for (const manifestPath of globSync(CLIENT_MANIFEST_GLOB, { cwd: root }).map(normalizePath).sort()) {
    const declaration = byManifest.get(manifestPath)
    if (declaration === undefined) throw new Error(GATE + ': no declaration facts for ' + manifestPath)
    const manifest = JSON.parse(readFileSync(resolve(root, manifestPath), 'utf8')) as Manifest
    if (typeof manifest.name !== 'string') throw new Error(GATE + ': ' + manifestPath + ' has no package name')
    const sourceUses = new Map<string, Set<string>>()
    const runtimeSourceUses = new Map<string, Set<string>>()
    const packageDirectory = dirname(manifestPath)
    const sourcePrefix = packageDirectory + '/src/'
    for (const sourceFile of sourceFiles) {
      if (sourceFile.isDeclarationFile) continue
      const file = project.relativePath(sourceFile)
      if (!file.startsWith(sourcePrefix)) continue
      for (const name of collectSourceFileUses(sourceFile, false, 'package')) {
        const locations = sourceUses.get(name) ?? new Set<string>()
        locations.add(file)
        sourceUses.set(name, locations)
      }
      for (const name of collectSourceFileUses(sourceFile, true, 'package')) {
        const locations = runtimeSourceUses.get(name) ?? new Set<string>()
        locations.add(file)
        runtimeSourceUses.set(name, locations)
      }
    }
    packages.push({
      ...declaration,
      staticLinked: staticLinkedPackages.has(declaration.name),
      sourceUses: Object.fromEntries(
        [...sourceUses].sort(([left], [right]) => left.localeCompare(right))
          .map(([name, locations]) => [name, [...locations].sort()]),
      ),
      runtimeSourceUses: Object.fromEntries(
        [...runtimeSourceUses].sort(([left], [right]) => left.localeCompare(right))
          .map(([name, locations]) => [name, [...locations].sort()]),
      ),
      dependencies: manifest.dependencies ?? {},
      peerDependencies: manifest.peerDependencies ?? {},
      devDependencies: manifest.devDependencies ?? {},
    })
  }

  return {
    packages,
    declarations,
    staticLinkedPackages,
    platformModules: readStringLiteralArray(root, PLATFORM_SOURCE, 'PLATFORM_MODULES'),
    preloadedExternals: readStringLiteralArray(root, PLATFORM_SOURCE, 'PRELOADED_CLIENT_EXTERNALS'),
    parserPreloadIds: readStringLiteralArray(root, PARSER_PRELOAD_SOURCE, 'PARSER_PRELOAD_IDS'),
    malformed,
  }
}

async function readStaticLinkedRoster(root: string): Promise<Set<string>> {
  const presetUrl = pathToFileURL(resolve(import.meta.dirname, '..', STATIC_PRESET_SOURCE)).href
  const preset = await import(presetUrl) as { isStaticLinkedConfig?: unknown }
  if (typeof preset.isStaticLinkedConfig !== 'function') {
    throw new Error(GATE + ': ' + STATIC_PRESET_SOURCE + ' exports no isStaticLinkedConfig')
  }
  const predicate = preset.isStaticLinkedConfig as (configs: readonly unknown[]) => boolean
  const roster = new Set<string>()
  for (const configPath of globSync(CONFIG_GLOB, { cwd: root }).map(normalizePath).sort()) {
    const loaded = await import(pathToFileURL(resolve(root, configPath)).href) as { default?: unknown }
    if (typeof loaded.default !== 'function') continue
    const configs = (loaded.default as (input: { env: Record<string, string> }) => unknown)({
      env: { DSH_BUILD_FACE: 'client' },
    })
    if (!Array.isArray(configs) || !predicate(configs)) continue
    const manifest = JSON.parse(
      readFileSync(resolve(root, configPath.replace(/tsdown\.config\.ts$/, 'package.json')), 'utf8'),
    ) as Manifest
    if (typeof manifest.name === 'string') roster.add(manifest.name)
  }
  return roster
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression
  while (ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isParenthesizedExpression(current)) {
    current = current.expression
  }
  return current
}

function readStringLiteralArray(root: string, sourcePath: string, name: string): string[] {
  const path = resolve(root, sourcePath)
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
  const constants = new Map<string, string>()
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue
      const initializer = unwrapExpression(declaration.initializer)
      if (ts.isStringLiteral(initializer)) constants.set(declaration.name.text, initializer.text)
    }
  }
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) continue
      const expression = declaration.initializer === undefined ? undefined : unwrapExpression(declaration.initializer)
      if (expression === undefined || !ts.isArrayLiteralExpression(expression)) {
        throw new Error(GATE + ': ' + name + ' in ' + sourcePath + ' must be an array literal')
      }
      return expression.elements.map((element) => {
        const value = unwrapExpression(element)
        if (ts.isStringLiteral(value)) return value.text
        if (ts.isIdentifier(value) && constants.has(value.text)) return constants.get(value.text) as string
        throw new Error(GATE + ': ' + name + ' in ' + sourcePath + ' must contain only string constants')
      })
    }
  }
  throw new Error(GATE + ': ' + sourcePath + ' declares no ' + name)
}
