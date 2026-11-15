/** Code-fence splice cases: when a fence-only edit propagates and when it must not. */

import { describe, expect, it } from 'vitest'
import { computeMechanicalUpdate } from './translation-brief.ts'

describe('mechanical code updates', () => {
  const en = '# T\n\nProse.\n\n```sh\nrun one\n```\n'
  const zh = '# T\n\n中文。\n\n```sh\nrun one\n```\n'

  it('splices a fence-only edit into the counterpart', () => {
    const edited = en.replace('run one', 'run two')
    expect(computeMechanicalUpdate(en, edited, zh)).toBe(zh.replace('run one', 'run two'))
  })

  it('refuses when prose changed too', () => {
    const edited = en.replace('Prose.', 'Prose!').replace('run one', 'run two')
    expect(computeMechanicalUpdate(en, edited, zh)).toBeUndefined()
  })

  it('refuses when the counterpart fences already diverge from last-confirmed', () => {
    const edited = en.replace('run one', 'run two')
    expect(computeMechanicalUpdate(en, edited, zh.replace('run one', 'run stale'))).toBeUndefined()
  })

  it('refuses when fence counts differ or nothing changed', () => {
    expect(computeMechanicalUpdate(en, `${en}\n\`\`\`sh\nextra\n\`\`\`\n`, zh)).toBeUndefined()
    expect(computeMechanicalUpdate(en, en, zh)).toBeUndefined()
  })
})
