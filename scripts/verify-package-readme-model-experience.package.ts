/** Per-package walk over one README's Model Experience section. */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { markdownHeadingLines, markdownProseLines } from './markdown.ts'
import { NO_MODEL_EXPERIENCE_SECTION } from './verify-package-readme-model-experience.no-section-allowlist.ts'
import { SENTENCE_MODEL_EXPERIENCE } from './verify-package-readme-model-experience.sentence-allowlist.ts'
import { parseModelContextEntries } from './verify-package-readme-model-experience.entries.ts'
import { isDirectSystemPromptEntry } from './verify-package-readme-model-experience.fields.ts'
import { checkStructuredGrounding } from './verify-package-readme-model-experience.section.ts'
import { checkShortForm } from './verify-package-readme-model-experience.short-form.ts'
import { HEADING, LIMITATIONS_HEADING } from './verify-package-readme-model-experience.types.ts'
import type { Counters, Failure, Line } from './verify-package-readme-model-experience.types.ts'

/**
 * Check one package README against the Model Experience rules, appending every
 * failure and tallying the audited outcomes it proves.
 * @param packageJson - repository-relative manifest path of the package.
 * @param root - repository root the README path resolves against.
 * @param toolCatalogFragments - H2 fragments `docs/tool-catalog.md` offers as anchors.
 * @param counters - running tallies the walk updates.
 * @param failures - failure list each problem is appended to.
 */
export function checkPackage(
  packageJson: string,
  root: string,
  toolCatalogFragments: ReadonlySet<string>,
  counters: Counters,
  failures: Failure[],
): void {
  const pkg = packageJson.slice(0, -'/package.json'.length)
  const readme = packageJson.replace(/package\.json$/, 'README.md')
  const abs = resolve(root, readme)
  if (!existsSync(abs)) {
    failures.push({ path: readme, message: 'missing package README' })
    return
  }

  const text = readFileSync(abs, 'utf8')
  const rawLines = text.split('\n')
  const lines = markdownProseLines(text)
  const headings = markdownHeadingLines(text)
  const h2Headings = headings.filter(heading => heading.depth === 2)
  const modelExperienceHeadings = headings.filter(heading => heading.text
    .trim().replaceAll(/\s+/g, ' ').toLowerCase() === 'model experience')
  const modelHeadings = modelExperienceHeadings.filter(heading => heading.depth === 2 && heading.raw === HEADING)
  if (NO_MODEL_EXPERIENCE_SECTION[pkg] !== undefined) {
    if (modelExperienceHeadings.length !== 0) {
      for (const heading of modelExperienceHeadings) {
        failures.push({ path: readme, message: `line ${heading.index}: audited model-agnostic package must omit every Model Experience heading; found ${JSON.stringify(heading.raw)}` })
      }
    } else {
      counters.omittedSectionCount += 1
    }
    return
  }
  const nonCanonicalModelHeading = modelExperienceHeadings.find(heading => heading.depth !== 2 || heading.raw !== HEADING)
  if (nonCanonicalModelHeading !== undefined) {
    failures.push({ path: readme, message: `line ${nonCanonicalModelHeading.index}: non-canonical Model Experience heading ${JSON.stringify(nonCanonicalModelHeading.raw)}; use exactly ${JSON.stringify(HEADING)}` })
    return
  }
  const modelHeading = modelHeadings.at(0)
  if (modelHeading === undefined) {
    failures.push({
      path: readme,
      message: `missing ${HEADING}`,
    })
    return
  }
  if (modelHeadings.length !== 1) {
    failures.push({ path: readme, message: `contains ${modelHeadings.length} copies of ${HEADING}` })
    return
  }
  const modelH2Index = h2Headings.indexOf(modelHeading)
  const limitationsH2Index = h2Headings.findIndex(heading => heading.depth === 2 && heading.raw === LIMITATIONS_HEADING)
  if (limitationsH2Index >= 0) {
    if (modelH2Index !== h2Headings.length - 2 || limitationsH2Index !== h2Headings.length - 1) {
      failures.push({
        path: readme,
        message: `${HEADING} and ${LIMITATIONS_HEADING} must be the final two H2 sections, in that order`,
      })
      return
    }
  } else if (modelH2Index !== h2Headings.length - 1) {
    failures.push({ path: readme, message: `${HEADING} must be the final H2 when ${LIMITATIONS_HEADING} is absent` })
    return
  }

  const modelHeadingAt = lines.findIndex(line => line.index === modelHeading.index)
  const body = lines.slice(modelHeadingAt + 1)
  const h2Lines = new Set(h2Headings.map(heading => heading.index))
  const nextH2 = body.findIndex(line => h2Lines.has(line.index))
  const section = nextH2 < 0 ? body : body.slice(0, nextH2)
  const nextH2Line = nextH2 < 0 ? rawLines.length + 1 : (body[nextH2] as Line).index
  const rawSection = rawLines.slice(modelHeading.index, nextH2Line - 1)
  const content = section.filter(line => line.raw.trim().length > 0)
  const sentenceContract = SENTENCE_MODEL_EXPERIENCE[pkg]
  if (sentenceContract !== undefined) {
    checkShortForm(readme, modelHeading.index, content, rawSection, sentenceContract, counters, failures)
    return
  }

  const modelContextEntries = parseModelContextEntries(
    readme,
    content,
    rawLines,
    nextH2Line,
    modelHeading.index,
    failures,
  )
  if (modelContextEntries === undefined) return
  if (!checkStructuredGrounding(readme, modelContextEntries, toolCatalogFragments, failures)) return
  counters.verbatimBlockCount += modelContextEntries.reduce((total, entry) => total + entry.verbatimBlocks, 0)
  counters.modelContextEntryCount += modelContextEntries.length
  counters.systemPromptEntryCount += modelContextEntries.filter(entry => isDirectSystemPromptEntry(entry.title)).length
  counters.toolSchemaEntryCount += modelContextEntries.filter(entry => /\bschemas?\b/i.test(entry.title)).length
  counters.kvCacheEffectCount += modelContextEntries.length
  counters.structuredCount += 1
}
