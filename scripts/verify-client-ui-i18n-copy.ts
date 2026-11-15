/**
 * Vocabulary deciding whether source text counts as product copy.
 *
 * These rules answer only "is this copy-bearing?"; the syntax walk that finds
 * candidates lives in `verify-client-ui-i18n-detect.ts`.
 */

import ts from 'typescript'

const COPY_ATTRIBUTES = new Set([
  'alt',
  'aria-description',
  'aria-label',
  'aria-valuetext',
  'cancelLabel',
  'closeLabel',
  'confirmLabel',
  'copyLabel',
  'description',
  'emptyLabel',
  'label',
  'placeholder',
  'title',
  'truncatedLabel',
])
const COPY_ATTRIBUTE_SUFFIX = /(?:Aria|Copy|Description|Heading|Label|Message|Placeholder|Summary|Text|Title|Tooltip)$/

/** Property and variable names that own product copy. */
export const COPY_NAME = /(?:^|_)(?:aria|copy|description|empty|heading|label|message|placeholder|summary|text|title|tooltip)(?:s|_.*)?$/i
/** Name suffixes that own product copy. */
export const COPY_SUFFIX = /(?:aria|copy|description|empty|heading|label|labels|message|placeholder|summary|text|title|tooltip|tabs)$/i
const IMMUTABLE_LANGUAGE_TOKENS = new Set([
  'B',
  'Function',
  'GB',
  'K',
  'KB',
  'M',
  'MB',
  'Symbol',
  'false',
  'function()',
  'n',
  'null',
  'true',
  'undefined',
])
const LOCALE_KEY = /^[a-z][a-zA-Z0-9]*(?:[._-][a-zA-Z0-9]+)+$/

/**
 * Whether a file owns translated text and may therefore hold literals.
 * @param file - Repository-relative source path.
 * @returns True for locale dictionaries.
 */
export function localeOwner(file: string): boolean {
  const normalized = file.replaceAll('\\', '/')
  const base = normalized.slice(normalized.lastIndexOf('/') + 1)
  return base === 'locale.ts'
    || base === 'locales.ts'
    || normalized.includes('/locales/')
}

/**
 * Whether a literal reads as product text rather than a machine token.
 * @param text - Literal text, possibly indented across lines.
 * @returns True when the normalized text carries language.
 */
export function containsProductText(text: string): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized !== ''
    && !IMMUTABLE_LANGUAGE_TOKENS.has(normalized)
    && !LOCALE_KEY.test(normalized)
    && /\p{L}/u.test(normalized)
}

/**
 * Read a property or binding name as written.
 * @param node - Property name or binding name.
 * @returns The identifier or string-literal text, otherwise undefined.
 */
export function propertyName(node: ts.PropertyName | ts.BindingName): string | undefined {
  return ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : undefined
}

/**
 * Whether a JSX attribute carries product copy.
 * @param name - Attribute name as written.
 * @returns True for copy-bearing names that are not locale keys.
 */
export function copyAttribute(name: string): boolean {
  return !name.endsWith('Key')
    && (COPY_ATTRIBUTES.has(name) || COPY_ATTRIBUTE_SUFFIX.test(name))
}

/**
 * Collapse a literal onto one diagnostic line.
 * @param text - Literal text, possibly indented across lines.
 * @returns At most 80 characters, without line breaks.
 */
export function compactText(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length <= 80 ? normalized : `${normalized.slice(0, 77)}...`
}

/**
 * Whether a literal reads as prose rather than a bare token.
 * @param text - Literal text, possibly indented across lines.
 * @returns True when it holds whitespace, CJK text, or a capitalized word.
 */
export function looksLikeNaturalText(text: string): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return /\s|[\u3400-\u9fff]/u.test(normalized) || /^[A-Z]/.test(normalized)
}
