/** Loader entry metadata validation: static fields stay literal, `disabled` alone interpolates. */

import { Script } from 'node:vm'
import { isAgentPresetEntry, isCordisGroupEntry, isJsExpr } from './cordis-yaml.ts'
import { errors, isRecord, isUnknownArray, pluginReferences } from './verify-cordis-config-shared.ts'

const metadataFields = ['id', 'name', 'group', 'inject', 'intercept', 'isolate'] as const

export function validateEntry(value: unknown, file: string, path: string): void {
  if (!isRecord(value)) {
    errors.push(`${file}${path}: entry must be an object`)
    return
  }
  recordPlugin(value, file)
  validateMetadata(value, file, path)
  if (isCordisGroupEntry(value)) {
    for (let index = 0; index < value.config.length; index++) {
      validateEntry(value.config[index], file, `${path}.config[${index}]`)
    }
  }
  if (isAgentPresetEntry(value)) {
    for (let index = 0; index < value.config.plugins.length; index++) validateEntry(value.config.plugins[index], file, `${path}.config.plugins[${index}]`)
  }
  if (isUnknownArray(value.insert)) {
    for (let index = 0; index < value.insert.length; index++) {
      validateEntry(value.insert[index], file, `${path}.insert[${index}]`)
    }
  }
  if (value.name !== '@deepseek-ai/cordis-plugin-include') return
  const config = value.config
  if (!isRecord(config) || !isUnknownArray(config.patches)) return
  for (let index = 0; index < config.patches.length; index++) {
    const patch = config.patches[index]
    const patchPath = `${path}.config.patches[${index}]`
    if (!isRecord(patch)) continue
    recordPlugin(patch, file)
    validateMetadata(patch, file, patchPath)
    if (!isUnknownArray(patch.insert)) continue
    for (let insertIndex = 0; insertIndex < patch.insert.length; insertIndex++) {
      validateEntry(patch.insert[insertIndex], file, `${patchPath}.insert[${insertIndex}]`)
    }
  }
}

function recordPlugin(entry: Record<string, unknown>, file: string): void {
  if (typeof entry.name === 'string') pluginReferences.push({ file, name: entry.name })
}

function validateMetadata(entry: Record<string, unknown>, file: string, path: string): void {
  for (const problem of metadataExpressionErrors(entry, path)) {
    errors.push(`${file}${problem}`)
  }
}

/**
 * Expression-node diagnostics for one entry. `disabled` is the single
 * interpolated metadata field: its own `!!js` expression node is allowed and
 * must parse, while expressions nested below it stay truthy data; every other
 * metadata field must stay fully static.
 * @param entry - one loader entry (or patch row).
 * @param path - the entry's diagnostic path prefix.
 * @returns one diagnostic per offending expression.
 */
export function metadataExpressionErrors(entry: Record<string, unknown>, path: string): string[] {
  const problems: string[] = []
  for (const field of metadataFields) {
    if (!(field in entry)) continue
    const expressionPaths: string[] = []
    collectExpressionPaths(entry[field], `${path}.${field}`, expressionPaths)
    for (const expressionPath of expressionPaths) problems.push(`${expressionPath}: !!js is not interpolated here`)
  }
  const disabled = entry.disabled
  if (disabled !== undefined) {
    if (isJsExpr(disabled)) {
      const detail = disabledExpressionProblem(disabled.__jsExpr)
      if (detail !== undefined) problems.push(`${path}.disabled${detail}`)
    } else {
      // A non-expression value gates on Boolean() at mount; an expression
      // nested anywhere below it never evaluates, so it must stay literal.
      const expressionPaths: string[] = []
      collectExpressionPaths(disabled, `${path}.disabled`, expressionPaths)
      for (const expressionPath of expressionPaths) problems.push(`${expressionPath}: !!js is not interpolated here`)
    }
  }
  return problems
}

/**
 * Parse-only validation of a `disabled` expression: the Loader evaluates it
 * at every mount decision, and a syntax error would fail the boot — rejecting
 * it here moves that failure to the earliest resolvable point.
 * @param expression - the `!!js` expression text.
 * @returns the diagnostic suffix, or `undefined` when the expression parses.
 */
function disabledExpressionProblem(expression: string): string | undefined {
  try {
    // Compilation only — constructing a Script does not execute its source.
    new Script(`(${expression})`)
    return undefined
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return `: disabled expression does not parse: ${detail}`
  }
}

function collectExpressionPaths(value: unknown, path: string, output: string[]): void {
  if (isJsExpr(value)) {
    output.push(path)
    return
  }
  if (isUnknownArray(value)) {
    for (let index = 0; index < value.length; index++) collectExpressionPaths(value[index], `${path}[${index}]`, output)
    return
  }
  if (!isRecord(value)) return
  for (const [key, child] of Object.entries(value)) collectExpressionPaths(child, `${path}.${key}`, output)
}
