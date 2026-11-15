/** Delayed-readiness disposition and pending-dispose cases of the global invariant host suite. */

import { describe, expect, it, vi } from 'vitest'
import { Context, FiberState } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  expectRequiredConfigValidation,
  invalidConfigApply,
  rejectionOf,
  requiredConfig,
  withDelayedFirstCompanion,
} from './test-invariants.harness-cases.ts'

describe('global test invariant host', () => {
  it('disposes invalid config after delayed invariant readiness', async () => {
    await withDelayedFirstCompanion(
      async ({ started, release }) => {
        const ctx = new Context()
        const apply = vi.fn(invalidConfigApply)
        const plugin = {
          apply,
          Config: requiredConfig(),
        }

        const fiber = ctx.plugin(plugin, {})
        const returnedError = rejectionOf(fiber)
        await started
        expect(fiber.state).toBe(FiberState.PENDING)
        expect(apply).not.toHaveBeenCalled()

        release()
        expectRequiredConfigValidation(await returnedError)
        expect(fiber.state).toBe(FiberState.DISPOSED)
        expect(apply).not.toHaveBeenCalled()
      },
    )
  })

  it('retains a valid plugin failure after delayed invariant readiness', async () => {
    await withDelayedFirstCompanion(
      async ({ started, release }) => {
        const ctx = new Context()
        const failure = new Error('valid plugin apply failed')
        const apply = vi.fn(function validConfigApply() {
          throw failure
        })
        const plugin = {
          apply,
          Config: z.object({}),
        }

        const fiber = ctx.plugin(plugin, {})
        const returnedError = rejectionOf(fiber)
        await started
        expect(fiber.state).toBe(FiberState.PENDING)
        expect(apply).not.toHaveBeenCalled()

        release()
        expect(await returnedError).toBe(failure)
        expect(fiber.state).toBe(FiberState.FAILED)
        expect(apply).toHaveBeenCalledOnce()
        expect(ctx.registry.has(plugin)).toBe(true)
        expect(ctx.registry.get(plugin)?.fibers).toHaveLength(1)
      },
    )
  })

  it('disposes a pending target without waiting for companion readiness', async () => {
    await withDelayedFirstCompanion(
      async ({ started, release }) => {
        const ctx = new Context()
        const targetApply = vi.fn(function targetApply() {})
        const targetFiber = ctx.plugin(targetApply)

        await started
        await expect(targetFiber.dispose()).resolves.toBeUndefined()
        expect(targetFiber.state).toBe(FiberState.DISPOSED)
        expect(targetApply).not.toHaveBeenCalled()

        release()
        await targetFiber
        expect(targetApply).not.toHaveBeenCalled()
      },
    )
  })
})
