/** Grounding and generated-catalog checks over one README's parsed entries. */

import { MODEL_VIEW_HEADING } from './verify-package-readme-model-experience.types.ts'
import type { Failure, ModelExperienceEntry } from './verify-package-readme-model-experience.types.ts'
import { isDirectSystemPromptEntry, toolCatalogLinkFragments } from './verify-package-readme-model-experience.fields.ts'

/**
 * Check that a structured section grounds every claim and links only catalog
 * sections that exist.
 * @param readme - repository-relative README path failures name.
 * @param entries - the section's parsed model-context entries.
 * @param toolCatalogFragments - H2 fragments `docs/tool-catalog.md` offers as anchors.
 * @param failures - failure list each problem is appended to.
 * @returns true when the section is grounded and every catalog link resolves.
 */
export function checkStructuredGrounding(
  readme: string,
  entries: readonly ModelExperienceEntry[],
  toolCatalogFragments: ReadonlySet<string>,
  failures: Failure[],
): boolean {
  const promptWithoutVerbatim = entries.find(entry => isDirectSystemPromptEntry(entry.title)
    && entry.modelViewVerbatimBlocks === 0)
  if (promptWithoutVerbatim !== undefined) {
    failures.push({ path: readme, message: `line ${promptWithoutVerbatim.heading.index}: system-prompt entry must contain a titled H5 plus verbatim \`markdown\` block under ${MODEL_VIEW_HEADING}` })
    return false
  }
  const hasConcreteLiteral = entries.some(entry => entry.verbatimBlocks > 0
    || entry.modelView.raw.includes('`')
    || entry.tokenEffect.raw.includes('`')
    || toolCatalogLinkFragments(entry.modelView.raw).length > 0)
  if (!hasConcreteLiteral) {
    failures.push({ path: readme, message: 'structured Model Experience must ground at least one entry with inline code, a nested `markdown` block, or an anchored tool-catalog link' })
    return false
  }
  for (const entry of entries) {
    if (!/\bschemas?\b/i.test(entry.title)) continue
    const fragments = toolCatalogLinkFragments(entry.modelView.raw)
    if (fragments.length === 0) {
      failures.push({ path: readme, message: `line ${entry.heading.index}: tool-schema entry must link an anchored section of ../../../docs/tool-catalog.md` })
      return false
    }
    const invalid = fragments.find(fragment => !toolCatalogFragments.has(fragment))
    if (invalid !== undefined) {
      failures.push({ path: readme, message: `line ${entry.modelView.index}: tool-catalog link fragment ${JSON.stringify(invalid)} does not name an H2 section` })
      return false
    }
  }
  return true
}
