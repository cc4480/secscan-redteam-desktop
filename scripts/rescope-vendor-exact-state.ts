/** Classification of one exact edit against the text it targets. */

import type { ExactEditState } from './rescope-vendor-types.ts'

/**
 * Classify one exact edit against its target text.
 *
 * An insertion keeps its anchor (`replace` contains `find`) and a deletion
 * keeps its remainder (`find` contains `replace`), so neither can be judged by
 * the source form alone: the surviving side counts the target form instead.
 * @param text - the complete current text of the edited file.
 * @param find - the source form, already oriented for the running direction.
 * @param replace - the target form, already oriented for the running direction.
 * @param expect - how many occurrences one complete application produces.
 * @returns Whether the edit is pending, already applied, or invalid.
 */
export function exactEditState(text: string, find: string, replace: string, expect: number): ExactEditState {
  const hits = text.split(find).length - 1
  const landed = text.split(replace).length - 1
  if (replace.includes(find)) {
    if (landed === expect) return 'applied'
    return landed === 0 && hits === expect ? 'pending' : 'invalid'
  }
  if (find.includes(replace)) {
    if (hits === 0) return landed === expect ? 'applied' : 'invalid'
    return hits === expect ? 'pending' : 'invalid'
  }
  if (hits === 0 && landed === expect) return 'applied'
  return hits === expect && landed === 0 ? 'pending' : 'invalid'
}
