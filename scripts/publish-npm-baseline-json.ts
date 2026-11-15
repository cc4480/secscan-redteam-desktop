/** JSON document reading and release-metadata validation for the npm baseline pipeline. */

import { readFileSync } from 'node:fs'

/**
 * Read one JSON object from disk.
 * @param path - absolute path of the JSON document.
 * @returns the parsed object.
 */
export function readObject(path: string): Record<string, unknown> {
  return parseObject(readFileSync(path, 'utf8'), path)
}

/**
 * Parse one JSON object from source text.
 * @param source - the JSON text.
 * @param context - label naming the document in validation errors.
 * @returns the parsed object.
 */
export function parseObject(source: string, context: string): Record<string, unknown> {
  const value: unknown = JSON.parse(source)
  if (!isRecord(value)) throw new Error(`${context} must contain a JSON object`)
  return value
}

/**
 * Test whether a value is a plain JSON object.
 * @param value - the value to test.
 * @returns true when the value is an object and not an array.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Read one required non-empty string field.
 * @param value - the object holding the field.
 * @param key - the field name.
 * @param context - label naming the document in validation errors.
 * @returns the field value.
 */
export function expectString(value: Record<string, unknown>, key: string, context: string): string {
  const result = value[key]
  if (typeof result !== 'string' || result === '') {
    throw new Error(`${context} must contain a non-empty ${key}`)
  }
  return result
}

/**
 * Normalize a registry URL to the form recorded in a release manifest.
 * @param value - the registry URL as given.
 * @returns the URL without trailing slashes.
 */
export function normalizeRegistry(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`registry must use HTTP or HTTPS: ${value}`)
  }
  return value.replace(/\/+$/, '')
}

/**
 * Reject a dist-tag the registry cannot address.
 * @param value - the candidate dist-tag.
 */
export function validateDistTag(value: string): void {
  if (value === '' || /\s/.test(value)) throw new Error(`invalid dist-tag: ${JSON.stringify(value)}`)
}

/**
 * Reject a version that is not a stable X.Y.Z baseline.
 * @param value - the candidate version.
 * @param context - label naming the source in validation errors.
 */
export function validateBaseVersion(value: string, context: string): void {
  if (!/^\d+\.\d+\.\d+$/.test(value)) {
    throw new Error(`${context} must have a stable X.Y.Z version, got ${value}`)
  }
}

/**
 * Parse `npm dist-tag ls` output into tag-to-version entries.
 * @param raw - the captured command output.
 * @param name - the package name, used in validation errors.
 * @returns the parsed tags.
 */
export function parseDistTagListing(raw: string, name: string): Map<string, string> {
  const tags = new Map<string, string>()
  for (const line of raw.split(/\r?\n/)) {
    if (line === '') continue
    const separator = line.indexOf(': ')
    if (separator <= 0 || separator + 2 === line.length) {
      throw new Error(`registry returned an invalid dist-tag for ${name}: ${line}`)
    }
    const tag = line.slice(0, separator)
    if (tags.has(tag)) throw new Error(`registry returned duplicate dist-tag ${tag} for ${name}`)
    tags.set(tag, line.slice(separator + 2))
  }
  return tags
}

/**
 * Format one instant as the pack timestamp.
 * @param value - the instant to format.
 * @returns the UTC timestamp with separators removed.
 */
export function formatUtcTimestamp(value: Date): string {
  if (!Number.isFinite(value.getTime())) throw new Error('pack timestamp must be a valid date')
  return value.toISOString().replaceAll(/[-:TZ.]/g, '').slice(0, 14)
}
