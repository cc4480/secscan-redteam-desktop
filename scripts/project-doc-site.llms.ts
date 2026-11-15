/**
 * The llms.txt index of the published raw-Markdown twins, for agent-facing
 * discovery of both locale trees.
 */

import { localeCollections, orderedPages, type DocsLocale } from '../website/docs.ts'

/** Site identity written into llms.txt. */
export interface LlmsTxtSite {
  /** Site base path, carrying the leading and trailing slashes VitePress requires. */
  base: string
  /** Site title. */
  title: string
  /** Site description. */
  description: string
}

/** Locale groups llms.txt lists, in the order the site's navigation presents them. */
const llmsTxtLocales: readonly { heading: string; locale: DocsLocale }[] = [
  { heading: '简体中文', locale: 'root' },
  { heading: 'English', locale: 'en' },
]

/**
 * The llms.txt index of every published page's raw-Markdown twin.
 *
 * Links are site-absolute so an agent resolves them against the host it
 * fetched llms.txt from; locale home pages stay out because this file is the
 * agent-facing entry point itself.
 *
 * @param site Site identity and base path.
 * @returns llms.txt content listing both locale trees.
 */
export function llmsTxt(site: LlmsTxtSite): string {
  const lines = [
    `# ${site.title}`,
    '',
    `> ${site.description}`,
    '',
    '页面 URL 去掉末尾斜杠再加 `.md` 即为该页原始 Markdown(根路径用 `/index.md`);下方列表是各页精确地址。Drop any trailing slash and append `.md` to a page URL for its raw Markdown (the site root is `/index.md`); the list below carries the exact addresses.',
  ]
  for (const { heading, locale } of llmsTxtLocales) {
    lines.push('', `## ${heading}`, '')
    for (const collection of localeCollections[locale]) {
      for (const page of orderedPages(locale, collection)) {
        lines.push(`- [${page.label}](${site.base}${page.route}): ${page.section}`)
      }
    }
  }
  return `${lines.join('\n')}\n`
}
