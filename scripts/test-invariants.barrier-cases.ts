/** Root-plugin barrier, derived-context, child-registration, and companion-failure cases. */

import { describe, expect, it, vi } from 'vitest'
import { Context, FiberState } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import {
  TEST_INVARIANT_READY_SERVICE,
  testInvariantCompanions,
  type TestInvariantCompanion,
} from './test-invariants.ts'
import { deferred, withDelayedFirstCompanion, withFakeCompanions } from './test-invariants.harness-cases.ts'

describe('global test invariant host', () => {
  it('holds a root plugin until every lazy companion is active, then permits nested startup', async () => {
    const delayedStarted = deferred()
    const releaseDelayed = deferred()
    const order: string[] = []
    let delayedCompanion: TestInvariantCompanion | undefined
    const companionNestedApply = vi.fn(function companionNestedApply() {})

    await withFakeCompanions(
      (path, index) => async () => {
        const companion: TestInvariantCompanion = {
          name: `test-invariant-${index}`,
          inject: ['invariants'],
          async apply(companionCtx) {
            order.push(`companion-start:${path}`)
            if (index === 0) {
              delayedStarted.resolve()
              await releaseDelayed.promise
            }
            if (index === 1) await companionCtx.plugin(companionNestedApply)
            order.push(`companion-active:${path}`)
            return () => {}
          },
        }
        if (index === 0) delayedCompanion = companion
        return companion
      },
      async () => {
        const ctx = new Context()
        ctx.provide('testInvariantTargetDependency', true)
        let nestedFiber: ReturnType<Context['plugin']> | undefined
        const nestedApply = vi.fn(function nestedApply() {
          order.push('nested')
        })
        const targetApply = Object.assign(vi.fn(function targetApply(targetCtx: Context) {
          order.push('target')
          nestedFiber = targetCtx.plugin(nestedApply)
        }), {
          inject: ['testInvariantTargetDependency'],
        })

        const targetFiber = ctx.plugin(targetApply)
        expect(ctx.registry.get(targetApply)?.callback).toBe(targetApply)
        expect(targetFiber.inject).toEqual({
          testInvariantTargetDependency: null,
          [TEST_INVARIANT_READY_SERVICE]: null,
        })

        await delayedStarted.promise
        await Promise.resolve()
        await Promise.resolve()
        expect(targetApply).not.toHaveBeenCalled()

        releaseDelayed.resolve()
        await targetFiber
        if (nestedFiber === undefined) throw new Error('target did not register its nested plugin')
        await nestedFiber

        expect(targetFiber.state).toBe(FiberState.ACTIVE)
        expect(targetApply).toHaveBeenCalledOnce()
        expect(nestedApply).toHaveBeenCalledOnce()
        expect(companionNestedApply).toHaveBeenCalledOnce()
        const targetIndex = order.indexOf('target')
        expect(targetIndex).toBeGreaterThan(-1)
        expect(order.slice(0, targetIndex)).toHaveLength(Object.keys(testInvariantCompanions).length * 2)
        expect(order.at(-1)).toBe('nested')

        if (delayedCompanion === undefined) throw new Error('delayed companion did not load')
        await ctx.plugin(InvariantRegistry, { enabled: true })
        await ctx.plugin(delayedCompanion)
        expect(ctx.registry.get(InvariantRegistry)?.fibers).toHaveLength(1)
        expect(ctx.registry.get(delayedCompanion)?.fibers).toHaveLength(1)
      },
    )
  })

  it('holds plugins registered on a root-derived context until companion readiness', async () => {
    await withDelayedFirstCompanion(
      async ({ started, release }) => {
        const ctx = new Context()
        const rootApply = vi.fn(function rootApply() {})
        const derivedApply = vi.fn(function derivedApply() {})
        const derived = ctx.extend()
          .isolate('testInvariantDerived')
          .intercept('testInvariantDerived', {})

        const rootFiber = ctx.plugin(rootApply)
        const derivedFiber = derived.plugin(derivedApply)

        await started
        await Promise.resolve()
        await Promise.resolve()
        expect(rootApply).not.toHaveBeenCalled()
        expect(derivedApply).not.toHaveBeenCalled()
        expect(derivedFiber.inject).toEqual({
          [TEST_INVARIANT_READY_SERVICE]: null,
        })

        release()
        await Promise.all([rootFiber, derivedFiber])
        expect(rootFiber.state).toBe(FiberState.ACTIVE)
        expect(derivedFiber.state).toBe(FiberState.ACTIVE)
        expect(rootApply).toHaveBeenCalledOnce()
        expect(derivedApply).toHaveBeenCalledOnce()
      },
    )
  })

  it('holds a child registered externally on a pending target context', async () => {
    await withDelayedFirstCompanion(
      async ({ started, release }) => {
        const ctx = new Context()
        const targetApply = vi.fn(function targetApply() {})
        const childApply = vi.fn(function childApply() {})

        const targetFiber = ctx.plugin(targetApply)
        const childFiber = targetFiber.ctx.plugin(childApply)

        await started
        await Promise.resolve()
        await Promise.resolve()
        expect(targetFiber.state).toBe(FiberState.PENDING)
        expect(childFiber.state).toBe(FiberState.PENDING)
        expect(targetApply).not.toHaveBeenCalled()
        expect(childApply).not.toHaveBeenCalled()
        expect(childFiber.inject).toEqual({
          [TEST_INVARIANT_READY_SERVICE]: null,
        })

        release()
        await Promise.all([targetFiber, childFiber])
        expect(targetFiber.state).toBe(FiberState.ACTIVE)
        expect(childFiber.state).toBe(FiberState.ACTIVE)
        expect(targetApply).toHaveBeenCalledOnce()
        expect(childApply).toHaveBeenCalledOnce()
      },
    )
  })

  it.each(['load', 'startup'] as const)(
    'rejects a target when a lazy companion fails during %s without starting the target',
    async (phase) => {
      const failure = new Error(`test invariant companion ${phase} failed`)
      await withFakeCompanions(
        (_path, index) => phase === 'load' && index === 0
          ? async () => { throw failure }
          : async () => ({
            name: `test-invariant-${index}`,
            inject: ['invariants'],
            async apply() {
              if (phase === 'startup' && index === 0) throw failure
              return () => {}
            },
          }),
        async () => {
          const ctx = new Context()
          const targetApply = vi.fn(function targetApply() {})
          const targetFiber = ctx.plugin(targetApply)

          await expect(targetFiber).rejects.toBe(failure)
          expect(targetApply).not.toHaveBeenCalled()
          expect(targetFiber.state).toBe(FiberState.PENDING)
          await expect(targetFiber.dispose()).resolves.toBeUndefined()
          expect(targetFiber.state).toBe(FiberState.DISPOSED)
        },
      )
    },
  )
})
