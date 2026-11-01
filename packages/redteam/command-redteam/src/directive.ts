/**
 * Operator-directive text for the RedTeam slash commands.
 *
 * Every directive is a plain user message: it enters the session log as an
 * ordinary user turn (or steering message), so what the model sees is
 * exactly what the log records — there is no hidden instruction channel.
 * The wording is fixed and pinned by the package tests; a command handler
 * only substitutes the operator's own target, tool name, and instruction.
 */

/** Usage line returned when `/scan` arrives without a target. */
export const SCAN_USAGE = 'Usage: /scan <target> — launch an engagement against the target as you would type it (for example /scan https://example.com).'

/** Usage line returned when `/use` arrives without a tool name. */
export const USE_USAGE = 'Usage: /use <tool> [instruction] — direct the agent to use the named tool for its next action (for example /use mcp__redteam__engagement_launch).'

/**
 * The `/scan` directive: start the engagement-launch flow for one target.
 * @param target - the target exactly as the operator typed it.
 * @returns the model-visible directive text.
 */
export function scanDirective(target: string): string {
  return `OPERATOR DIRECTIVE (/scan): launch a new engagement now against ${target} using your engagement_launch tool, with the target exactly as the operator gave it. Report the engagement id and the first status back in this thread. Do not substitute a service scan for the engagement.`
}

/**
 * The `/status` directive: report the current engagement snapshot.
 * @returns the model-visible directive text.
 */
export function statusDirective(): string {
  return 'OPERATOR DIRECTIVE (/status): call engagement_status now and report the current engagement snapshot in this thread — status, phase, event and finding counts, and the halt or block reason when there is one.'
}

/**
 * The `/report` directive: deliver the finished report in the thread.
 * @returns the model-visible directive text.
 */
export function reportDirective(): string {
  return 'OPERATOR DIRECTIVE (/report): call engagement_report now and deliver the finished report in this thread. If it returns ready:false, say the report is not ready yet and give the current status instead — do not invent report content.'
}

/**
 * The `/use` directive: bind the next tool action to one named tool.
 * @param tool - the validated tool name from the seat's real catalog.
 * @param instruction - the operator's optional extra instruction, verbatim.
 * @returns the model-visible directive text.
 */
export function useDirective(tool: string, instruction: string): string {
  const extra = instruction === '' ? '' : ` Operator instruction: ${instruction}`
  return `OPERATOR DIRECTIVE (/use): for your next tool action, use the tool \`${tool}\`.${extra} This directive comes from the operator's /use command and overrides your default tool choice for the next action only.`
}

/** One parsed `/use` invocation: the tool token plus the remaining instruction. */
export interface UseInput {
  /** The first whitespace-delimited token: the tool name as typed. */
  readonly tool: string
  /** Everything after the tool token, trimmed; empty when absent. */
  readonly instruction: string
}

/**
 * Split `/use` input into tool token and instruction.
 * @param rawInput - the text following the command name, separator included.
 * @returns the parsed input, or `undefined` when no tool token is present.
 */
export function parseUseInput(rawInput: string): UseInput | undefined {
  const trimmed = rawInput.trim()
  if (trimmed === '') return undefined
  const splitAt = trimmed.search(/\s/u)
  if (splitAt === -1) return { tool: trimmed, instruction: '' }
  return { tool: trimmed.slice(0, splitAt), instruction: trimmed.slice(splitAt).trim() }
}

/**
 * Render a bounded, sorted sample of a tool catalog for an error message.
 * @param names - the catalog's tool names, in any order.
 * @param limit - the maximum number of names to include.
 * @returns the names joined for display, with an explicit truncation note.
 */
export function catalogSample(names: readonly string[], limit: number): string {
  const sorted = [...names].sort()
  if (sorted.length <= limit) return sorted.join(', ')
  return `${sorted.slice(0, limit).join(', ')}, … (${sorted.length} total)`
}
