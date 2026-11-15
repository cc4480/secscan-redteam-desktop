/** Rejected-config disposition cases of the global invariant host suite. */

import { describe, expect, it, vi } from 'vitest'
import { Context, FiberState } from '@deepseek-ai/cordis'
import {
  expectRequiredConfigValidation,
  invalidConfigApply,
  rejectionOf,
  requiredConfig,
  TestInvariantProbe,
} from './test-invariants.harness-cases.ts'

describe('global test invariant host', () => {
  it('preserves config validation failures without starting the rejected plugin', async () => {
    const ctx = new Context()
    const apply = vi.fn(invalidConfigApply)
    const plugin = {
      apply,
      Config: requiredConfig(),
    }

    const fiber = ctx.plugin(plugin, {})
    const firstError = await rejectionOf(fiber)
    expectRequiredConfigValidation(firstError)
    await ctx.plugin(TestInvariantProbe)
    const secondError = await rejectionOf(fiber)
    expect(secondError).toBe(firstError)
    expect(fiber.state).toBe(FiberState.DISPOSED)
    expect(apply).not.toHaveBeenCalled()
  })
})
