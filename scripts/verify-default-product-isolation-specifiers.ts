/**
 * Package-name, source-resolution, and record helpers the default-product isolation scans share.
 */

import { existsSync, statSync } from 'node:fs'
import { extname, relative, resolve } from 'node:path'
import ts from 'typescript'
import { collectRuntimeLocalSourceSpecifiers } from './verify-client-packages.ts'

/**
 * Render a filesystem path as a repository-relative `/`-separated path.
 * @param root - repository root.
 * @param path - absolute path inside the repository.
 * @returns the path reported in violations.
 */
export function displayPath(root: string, path: string): string {
  return relative(root, path).replaceAll('\\', '/')
}

/**
 * Reduce an import specifier to its package name.
 * @param specifier - bare or subpath import specifier.
 * @returns the bare package name without its subpath.
 */
export function barePackageName(specifier: string): string {
  return /^(?:@[^/]+\/)?[^/@]+/.exec(specifier)?.[0] ?? specifier
}

/**
 * Resolve a runtime specifier to the source file that satisfies it.
 * @param path - absolute path or extensionless path the specifier names.
 * @returns the existing file, or undefined when the specifier names no source file.
 */
export function resolveSource(path: string): string | undefined {
  const extension = extname(path)
  if (extension !== '' && !/^\.[cm]?[jt]sx?$/.test(extension)
    && !(existsSync(path) && statSync(path).isDirectory())) return undefined
  const extensions = ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx']
  const typed = extension === '.js' ? [path.replace(/\.js$/, '.ts'), path.replace(/\.js$/, '.tsx')]
    : extension === '.mjs' ? [path.replace(/\.mjs$/, '.mts')]
      : extension === '.cjs' ? [path.replace(/\.cjs$/, '.cts')] : []
  return [path, ...typed, ...extension === '' ? extensions.map(suffix => `${path}${suffix}`) : [],
    ...extensions.map(suffix => resolve(path, `index${suffix}`))]
    .find(candidate => existsSync(candidate) && statSync(candidate).isFile())
}

/**
 * Collect every local specifier a runtime source can reach, including `new URL` requests.
 * @param path - path recorded for parse errors.
 * @param source - runtime source text.
 * @returns the local specifiers the source reaches.
 */
export function runtimeLocalSpecifiers(path: string, source: string): Set<string> {
  const specifiers = collectRuntimeLocalSourceSpecifiers(path, source, true)
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)
  const visit = (node: ts.Node): void => {
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'URL') {
      const first = node.arguments?.[0]
      if (first !== undefined && ts.isStringLiteralLike(first)
        && (first.text.startsWith('.') || first.text.startsWith('/'))) specifiers.add(first.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return specifiers
}

/**
 * Narrow an unknown composition node to a record.
 * @param value - value read from a shipped composition.
 * @returns whether the value is a non-array object.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
