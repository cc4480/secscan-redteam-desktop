/** The module-request cases: what a Client bundle asks its declaration for. */

import { describe, expect, it } from 'vitest'
import { requestedExternals } from '../packages/client/tsdown.client.ts'

describe('client bundle module requests', () => {
  it('requests what the declaration lists', () => {
    const requests = requestedExternals('@deepseek-ai/dsh-client-fixture', {
      external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-slots'],
    })

    expect([...requests].sort()).toEqual([
      '@deepseek-ai/dsh-client-ui-slots', 'react', 'react/jsx-runtime',
    ])
  })

  it('requests nothing when the declaration is absent', () => {
    expect(requestedExternals('@deepseek-ai/dsh-client-fixture', {}).size).toBe(0)
  })

  it('rejects a malformed declaration instead of reading past it', () => {
    expect(() => requestedExternals('@deepseek-ai/dsh-client-fixture', { external: 'react' }))
      .toThrow(/dsh\.client\.external must be a string array/)
  })
})
