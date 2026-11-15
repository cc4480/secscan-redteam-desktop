/**
 * Table layout and virtualization tunables, the kind label map, and the detail
 * tab tables.
 */
import type { TrajectoryCellKind } from './trajectory-record.ts'
import type { TrajectoryKey } from './locales.ts'
import type { DetailTabItem } from './trajectory-table-types.ts'

export const BOTTOM_FOLLOW_THRESHOLD_PX = 2

export const OLDER_LOAD_THRESHOLD_PX = 48

export const HISTORY_LOAD_ROW_HEIGHT_PX = 30

export const VIRTUALIZATION_THRESHOLD = 100

export const VIRTUAL_OVERSCAN_ROWS = 12

export const VIRTUAL_INITIAL_VIEWPORT_HEIGHT_PX = 600

export const KIND_LABEL_KEY: Record<TrajectoryCellKind, TrajectoryKey> = {
  system: 'kind.system',
  user: 'kind.user',
  context: 'kind.context',
  compacted: 'kind.compacted',
  message: 'kind.assistant',
  tool: 'kind.tool',
  subtool: 'kind.subtool',
}

export const DETAILS_MIN_WIDTH = 320

export const DETAILS_MAX_WIDTH = 720

export const TABLE_MIN_WIDTH = 280

export const DETAILS_RESIZE_STEP = 16

export const TOOL_REQUEST_SHARE = 0.58

export const TOOL_REQUEST_MIN_WIDTH = 180

export const TOOL_REQUEST_MAX_WIDTH = 480

export const DEFAULT_TOOL_REQUEST_SHARE = 0.36

export const DEFAULT_TOOL_REQUEST_OFFSET = 56

export const SYSTEM_PROMPT_TABS: readonly DetailTabItem[] = [
  { id: 'system-prompt', labelKey: 'tab.systemPrompt' },
  { id: 'tools', labelKey: 'tab.tools' },
]

export const SYSTEM_UPDATE_TABS: readonly DetailTabItem[] = [
  { id: 'diff', labelKey: 'tab.diff' },
  ...SYSTEM_PROMPT_TABS,
]

export const REQUEST_TABS: readonly DetailTabItem[] = [
  { id: 'overview', labelKey: 'tab.summary' },
  { id: 'options', labelKey: 'tab.options' },
  { id: 'usage', labelKey: 'tab.usage' },
  { id: 'timing', labelKey: 'tab.timing' },
]
