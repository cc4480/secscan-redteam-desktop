/**
 * Locale label bundles handed to the shared tree and markdown primitives, the
 * details-pane width clamp, and the click-selects-text guard.
 */
import type { TrajectoryTranslate } from './locales.ts'
import type { JsonTreeLabels, MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  DEFAULT_TOOL_REQUEST_OFFSET, DEFAULT_TOOL_REQUEST_SHARE, DETAILS_MAX_WIDTH, DETAILS_MIN_WIDTH,
  TABLE_MIN_WIDTH, TOOL_REQUEST_MAX_WIDTH, TOOL_REQUEST_MIN_WIDTH,
} from './trajectory-table-constants.ts'

export function jsonTreeLabels(t: TrajectoryTranslate): JsonTreeLabels {
  return {
    copyValue: t('copy.value'),
    copyJson: t('copy.json'),
    copyPath: t('copy.path'),
    copyPrettyJson: t('copy.prettyJson'),
    copyCompactJson: t('copy.compactJson'),
    copied: t('copied'),
    copyFailed: t('copy.failed'),
    collapseNode: t('collapse'),
    expandNode: t('expand'),
    copyButtonTitle: action => t('copy.optionsHint', { action }),
  }
}

export function markdownLabels(t: TrajectoryTranslate): MarkdownLabels {
  return {
    code: { copyLabel: t('copy'), copiedLabel: t('copied') },
    footnotes: t('markdown.footnotes'),
  }
}

export function clampDetailsWidth(width: number, splitWidth: number): number {
  const maxWidth = Math.max(
    DETAILS_MIN_WIDTH,
    Math.min(DETAILS_MAX_WIDTH, splitWidth - TABLE_MIN_WIDTH),
  )
  return Math.round(Math.min(Math.max(width, DETAILS_MIN_WIDTH), maxWidth))
}

export function defaultToolRequestWidth(splitWidth: number): number {
  return Math.min(
    Math.max(
      splitWidth * DEFAULT_TOOL_REQUEST_SHARE - DEFAULT_TOOL_REQUEST_OFFSET,
      TOOL_REQUEST_MIN_WIDTH,
    ),
    TOOL_REQUEST_MAX_WIDTH,
  )
}

/** Whether a click lands on an active text selection and should keep it. */
export function clickSelectsText(target: Node): boolean {
  const selection = window.getSelection()
  return selection !== null
    && !selection.isCollapsed
    && selection.rangeCount > 0
    && selection.getRangeAt(0).intersectsNode(target)
}
