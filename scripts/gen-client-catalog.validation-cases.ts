/** The contract checks that must reject an unteachable slot declaration or registration. */

import { describe, expect, it } from 'vitest'
import { validateSlotContracts } from './gen-client-catalog.ts'
import { declaration, registration, OWNER_TYPES } from './gen-client-catalog.fixtures-cases.ts'

describe('client slot contract validation', () => {
  it('accepts a documented slot whose owner props resolve', () => {
    expect(validateSlotContracts(
      [declaration({ ownerType: 'DemoOwnerProps' })],
      [registration()],
      OWNER_TYPES,
    )).toEqual([])
  })

  it('rejects a slot with no registrant-facing prose, naming the writing template', () => {
    const problems = validateSlotContracts([declaration({ jsDoc: '' })], [], new Map())
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('has no JSDoc prose')
    expect(problems[0]).toContain('ui-settings')
  })

  it.each([
    ['kind', { kind: 'whatever' }],
    ['scope', { scope: 'whatever' }],
  ])('rejects a slot whose %s is not one of the contract literals', (field, over) => {
    const problems = validateSlotContracts([declaration(over)], [], new Map())
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain(`no literal '${field}'`)
  })

  it('rejects owner props no exported declaration provides', () => {
    const problems = validateSlotContracts([declaration({ ownerType: 'MissingProps' })], [], new Map())
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('MissingProps')
  })

  it('rejects the same key declared twice, because a merge would hide one contract', () => {
    const problems = validateSlotContracts(
      [declaration(), declaration({ source: 'packages/client/other/src/client/slots.ts:3' })],
      [],
      new Map(),
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('is also declared at')
  })

  it('rejects a registration into an undeclared slot as a scan blind spot', () => {
    const problems = validateSlotContracts([declaration()], [registration({ key: 'ghost.seat' })], new Map())
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('blind spot')
  })

  it('rejects a children declaration for a slot no merge types', () => {
    const problems = validateSlotContracts([declaration()], [registration({ children: ['ghost.child'] })], new Map())
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain("child slot 'ghost.child'")
  })
})
