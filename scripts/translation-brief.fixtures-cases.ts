/** Documents and terminology tables shared by the translation-brief cases. */

/** Exercises each Markdown container kind the span mappers distinguish. */
export const DOC = [
  'Preamble line.',
  '',
  '# Title',
  '',
  'Intro paragraph.',
  '',
  '## First',
  '',
  'First body.',
  '',
  '```ts',
  'const value = 1',
  '```',
  '',
  '## Second',
  '',
  '| A | B |',
  '|---|---|',
  '| 1 | 2 |',
  '',
  '- item one',
  '- item two',
].join('\n')

/**
 * A terminology table carrying a first-occurrence rendering for `agent` only,
 * so the cases can tell annotated rows from bare ones.
 */
export const TERMINOLOGY = [
  '| English | 中文 | 首次出现 | 不要译作 | 备注 |',
  '|---|---|---|---|---|',
  '| agent | agent | agent（智能体） | 智能体 | |',
  '| session log | 会话日志 | | 会话记录 | |',
  '| gate | 门禁 | | | |',
  '| registry | 注册表 | | | |',
].join('\n')
