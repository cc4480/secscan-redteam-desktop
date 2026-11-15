/**
 * Package and configuration inputs: read a tsconfig, inventory a manifest's export subpaths, and map a published target onto its source file.
 *
 * @module @deepseek-ai/dsh-typert-generator/analyzer-manifest
 */

import {
  dirname,
  extname,
  join,
  resolve,
  sep,
} from 'node:path'
import ts from 'typescript'
import { TypertAnalysisError } from './analyzer-types.ts'
import type { ParsedConfig } from './analyzer-types.ts'
import { typertMode, typertServiceTag } from './analyzer-declaration.ts'
import { formatDiagnostic } from './analyzer-diagnostic.ts'
import { expressionName, memberName } from './analyzer-member.ts'
import type { PackageModel } from './model.ts'

/** Read and fully resolve one tsconfig, failing on any configuration error. */
export function parseConfig(path: string): ParsedConfig {
  const compilerPath = path.split(sep).join('/')
  const read = ts.readConfigFile(compilerPath, file => ts.sys.readFile(file))
  if (read.error !== undefined) throw new TypertAnalysisError(formatDiagnostic(read.error))
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(compilerPath), undefined, compilerPath)
  if (parsed.errors.length > 0) throw new TypertAnalysisError(parsed.errors.map(formatDiagnostic).join('\n'))
  return { path, parsed }
}

/** Resolve one project reference to the tsconfig path it names. */
export function projectConfigPath(path: string): string {
  if (extname(path) === '.json') return path
  return join(path, 'tsconfig.json')
}

/** Whether one source file declares Typert surface that a catalog or emitter projects. */
export function sourceFileHasSurface(sourceFile: ts.SourceFile): boolean {
  for (const statement of sourceFile.statements) {
    if ((ts.isClassDeclaration(statement)
      || ts.isInterfaceDeclaration(statement)
      || ts.isTypeAliasDeclaration(statement)
      || ts.isEnumDeclaration(statement))
      && (typertMode(statement) !== undefined || typertServiceTag(statement) !== undefined)) return true
    if (ts.isClassDeclaration(statement)) {
      for (const member of statement.members) {
        if (ts.isPropertyDeclaration(member)
          && memberName(member.name) === 'typertRemote'
          && member.initializer !== undefined
          && ts.isCallExpression(member.initializer)
          && expressionName(member.initializer.expression) === 'bindTypertRemote') return true
        for (const decorator of ts.canHaveDecorators(member) ? ts.getDecorators(member) ?? [] : []) {
          const expression = ts.isCallExpression(decorator.expression)
            ? decorator.expression.expression
            : decorator.expression
          const name = expressionName(expression)
          if (name === 'Remote' || name === 'RemoteScope') return true
        }
      }
    }
    if (!ts.isModuleDeclaration(statement)
      || !ts.isStringLiteral(statement.name)
      || statement.name.text !== '@deepseek-ai/cordis'
      || statement.body === undefined
      || !ts.isModuleBlock(statement.body)) continue
    if (statement.body.statements.some(member => ts.isInterfaceDeclaration(member)
      && (member.name.text === 'Context' || member.name.text === 'Events')
      && member.members.length > 0)) return true
  }
  return false
}

/** Whether one package model carries any declared surface. */
export function hasPackageSurface(model: PackageModel): boolean {
  return model.services.length > 0
    || model.events.length > 0
    || model.objects.length > 0
    || model.schemas.length > 0
    || model.invocations.length > 0
}

/** Whether one manifest declares both a Host face and Client export subpaths. */
export function isDualFacePackage(manifest: Record<string, unknown>): boolean {
  const dsh = manifest.dsh
  const client = dsh !== null && typeof dsh === 'object'
    ? (dsh as Record<string, unknown>).client
    : undefined
  return client !== null
    && typeof client === 'object'
    && clientExportSubpaths(manifest).length > 0
}

/** The export subpaths that belong to the Host face. */
export function hostExportSubpaths(manifest: Record<string, unknown>): string[] {
  return packageExportTargets(manifest)
    .map(([subpath]) => subpath)
    .filter(subpath => subpath !== './client'
      && !subpath.startsWith('./client/')
      && subpath !== './remote')
}

/** The export subpaths that belong to the Client face. */
export function clientExportSubpaths(manifest: Record<string, unknown>): string[] {
  return packageExportTargets(manifest)
    .map(([subpath]) => subpath)
    .filter(subpath => subpath === './client' || subpath.startsWith('./client/'))
}

/** Every export subpath one manifest declares, paired with its resolution target. */
export function packageExportTargets(manifest: Record<string, unknown>): [string, string][] {
  const exportsField = manifest.exports
  if (typeof exportsField === 'string') return [['.', exportsField]]
  if (exportsField === null || typeof exportsField !== 'object') {
    const types = manifest.types
    return typeof types === 'string' ? [['.', types]] : []
  }
  if (Array.isArray(exportsField)
    || !Object.keys(exportsField).some(key => key.startsWith('.'))) {
    const target = exportTarget(exportsField)
    return target === undefined ? [] : [['.', target]]
  }
  const result: [string, string][] = []
  for (const [subpath, value] of Object.entries(exportsField as Record<string, unknown>)) {
    if (!subpath.startsWith('.')) continue
    const target = exportTarget(value)
    if (target !== undefined) result.push([subpath, target])
  }
  return result.sort(([left], [right]) => left.localeCompare(right))
}

/** The first resolvable target of one exports or condition value. */
export function exportTarget(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const target = exportTarget(candidate)
      if (target !== undefined) return target
    }
    return undefined
  }
  if (value === null || typeof value !== 'object') return undefined
  const conditions = value as Record<string, unknown>
  for (const key of ['types', 'import', 'default']) {
    const target = exportTarget(conditions[key])
    if (target !== undefined) return target
  }
  for (const candidate of Object.values(conditions)) {
    const target = exportTarget(candidate)
    if (target !== undefined) return target
  }
  return undefined
}

/** Map one published export target onto the source file that produces it. */
export function sourcePathForExport(packageRoot: string, target: string): string {
  const normalized = target.replace(/^\.\//, '')
  if (normalized.startsWith('lib/types/')) {
    return resolve(packageRoot, 'src', normalized.slice('lib/types/'.length).replace(/\.d\.(?:mts|cts|ts)$/, '.ts'))
  }
  if (normalized.startsWith('lib/')) {
    return resolve(packageRoot, 'src', normalized.slice('lib/'.length).replace(/\.(?:mjs|cjs|js|d\.ts)$/, '.ts'))
  }
  return resolve(packageRoot, normalized)
}

