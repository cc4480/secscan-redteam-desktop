/** Parse the structural H3/H4/H5 model-context entries of one README section. */

import { FIELD_HEADINGS } from './verify-package-readme-model-experience.types.ts'
import type { Failure, Line, ModelExperienceEntry, ParsedField } from './verify-package-readme-model-experience.types.ts'
import { headingFragment, validateNestedVerbatim } from './verify-package-readme-model-experience.fields.ts'

/**
 * Parse one README's structured model-context entries, recording the first
 * structural failure and abandoning the section.
 * @param readme - repository-relative README path failures name.
 * @param content - the section's non-blank prose lines.
 * @param rawLines - the README's raw source lines.
 * @param nextH2Line - raw line index of the H2 that ends the section.
 * @param modelHeadingIndex - line index of the section's H2 heading.
 * @param failures - failure list each problem is appended to.
 * @returns the parsed entries, or undefined when the section already failed.
 */
export function parseModelContextEntries(
  readme: string,
  content: readonly Line[],
  rawLines: readonly string[],
  nextH2Line: number,
  modelHeadingIndex: number,
  failures: Failure[],
): ModelExperienceEntry[] | undefined {
  const shortSentence = content.find(line => line.raw === 'None.' || /^None, as |^Indirectly, through /.test(line.raw))
  if (shortSentence !== undefined) {
    failures.push({ path: readme, message: `line ${shortSentence.index}: short Model Experience form requires an audited entry in SENTENCE_MODEL_EXPERIENCE` })
    return undefined
  }

  const entryStarts = content
    .map((line, index) => ({ line, index }))
    .filter(entry => /^### \S/.test(entry.line.raw))
  if (entryStarts.length === 0 || entryStarts[0]?.index !== 0) {
    failures.push({ path: readme, message: 'must contain one or more complete model-context entries' })
    return undefined
  }

  const modelContextEntries: ModelExperienceEntry[] = []
  const entryFragments = new Set<string>()
  for (let entryIndex = 0; entryIndex < entryStarts.length; entryIndex += 1) {
    const start = entryStarts[entryIndex] as { line: Line; index: number }
    const end = entryStarts[entryIndex + 1]?.index ?? content.length
    const entries = content.slice(start.index, end)
    const heading = entries[0] as Line
    const title = heading.raw.slice('### '.length)
    const fragment = headingFragment(title)
    if (fragment.length === 0) {
      failures.push({ path: readme, message: `line ${heading.index}: each model-context entry requires a non-empty H3 heading` })
      return undefined
    }
    if (entryFragments.has(fragment)) {
      failures.push({ path: readme, message: `line ${heading.index}: duplicate model-context entry link fragment ${JSON.stringify(fragment)}` })
      return undefined
    }
    const fieldStarts = entries
      .map((line, index) => ({ line, index }))
      .filter(entry => /^#### \S/.test(entry.line.raw))
    if (fieldStarts.length !== FIELD_HEADINGS.length || fieldStarts[0]?.index !== 1) {
      failures.push({ path: readme, message: `line ${heading.index}: model-context entry requires exactly three ordered H4 fields: ${FIELD_HEADINGS.join(', ')}` })
      return undefined
    }
    if ((entryIndex === 0 && heading.index !== modelHeadingIndex + 2)
      || rawLines[heading.index - 2]?.trim().length !== 0
      || fieldStarts[0].line.index !== heading.index + 2) {
      failures.push({ path: readme, message: `line ${heading.index}: model-context entry heading and first field require one blank line between them` })
      return undefined
    }
    const parsedFields: ParsedField[] = []
    const verbatimFragments = new Set<string>()
    for (let fieldIndex = 0; fieldIndex < FIELD_HEADINGS.length; fieldIndex += 1) {
      const fieldStart = fieldStarts[fieldIndex] as { line: Line; index: number }
      const expectedHeading = FIELD_HEADINGS[fieldIndex] as string
      if (fieldStart.line.raw !== expectedHeading) {
        failures.push({ path: readme, message: `line ${fieldStart.line.index}: expected exact field heading ${JSON.stringify(expectedHeading)}, found ${JSON.stringify(fieldStart.line.raw)}` })
        return undefined
      }
      const fieldEnd = fieldStarts[fieldIndex + 1]?.index ?? entries.length
      const fieldEntries = entries.slice(fieldStart.index, fieldEnd)
      const value = fieldEntries[1]
      if (value === undefined || /^#{1,6} /.test(value.raw) || value.raw.trim().length === 0) {
        failures.push({ path: readme, message: `line ${fieldStart.line.index}: ${expectedHeading} requires one non-empty paragraph` })
        return undefined
      }
      if (value.index !== fieldStart.line.index + 2) {
        failures.push({ path: readme, message: `line ${fieldStart.line.index}: ${expectedHeading} and its paragraph require one blank line between them` })
        return undefined
      }
      const unexpected = fieldEntries.slice(2).find(line => !/^##### \S/.test(line.raw))
      if (unexpected !== undefined) {
        failures.push({ path: readme, message: `line ${unexpected.index}: content after ${expectedHeading} paragraph must be a titled H5 plus \`markdown\` fence owned by that field` })
        return undefined
      }
      const nextHeadingLine = fieldStarts[fieldIndex + 1]?.line.index
        ?? entryStarts[entryIndex + 1]?.line.index
        ?? nextH2Line
      if (rawLines[nextHeadingLine - 2]?.trim().length !== 0) {
        failures.push({ path: readme, message: `line ${nextHeadingLine}: Model Experience headings require a preceding blank line` })
        return undefined
      }
      const verbatim = validateNestedVerbatim(rawLines.slice(value.index, nextHeadingLine - 1), verbatimFragments)
      if (verbatim.error !== undefined) {
        failures.push({ path: readme, message: `line ${value.index}: ${verbatim.error}` })
        return undefined
      }
      if (fieldEntries.length - 2 !== verbatim.blocks) {
        failures.push({ path: readme, message: `line ${value.index}: every nested H5 must own exactly one \`markdown\` fence` })
        return undefined
      }
      parsedFields.push({ value, verbatimBlocks: verbatim.blocks })
    }
    const modelViewField = parsedFields[0] as ParsedField
    const tokenEffectField = parsedFields[1] as ParsedField
    const kvCacheEffectField = parsedFields[2] as ParsedField
    const modelView = modelViewField.value
    const tokenEffect = tokenEffectField.value
    const kvCacheEffect = kvCacheEffectField.value
    if (/\]\(#[^)]+\)/.test(modelView.raw) || /\]\(#[^)]+\)/.test(tokenEffect.raw) || /\]\(#[^)]+\)/.test(kvCacheEffect.raw)) {
      failures.push({ path: readme, message: `line ${heading.index}: Model Experience fields must not link between local subsections; nest the H5 in its owning H4 field` })
      return undefined
    }
    entryFragments.add(fragment)
    modelContextEntries.push({
      heading,
      modelView,
      tokenEffect,
      kvCacheEffect,
      title,
      modelViewVerbatimBlocks: modelViewField.verbatimBlocks,
      verbatimBlocks: parsedFields.reduce((total, field) => total + field.verbatimBlocks, 0),
    })
  }
  return modelContextEntries
}
