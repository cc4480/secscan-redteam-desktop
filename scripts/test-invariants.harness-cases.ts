/**
 * Service, deferred control, and companion-stubbing fixtures shared by the
 * split test-invariant host cases. The host contract those cases exercise lives
 * in `test-invariants.ts`.
 */

import { expect } from 'vitest'
import { Context, Service, ValidationError } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { testInvariantCompanions, type TestInvariantCompanion } from './test-invariants.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    testInvariantProbe: TestInvariantProbe
  }
}

/** Test-only service that gives a bare root context an invariant registry to attach to. */
export class TestInvariantProbe extends Service {
  constructor(ctx: Context) {
    super(ctx, 'testInvariantProbe')
  }
}

/** A promise and its external resolver, used to hold companion startup open. */
export function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

/** Config schema whose `requiredValue` field rejects an empty plugin config. */
export function requiredConfig() {
  return z.object({
    requiredValue: z.string().required(),
  })
}

/** Apply body that fails the suite if a rejected-config plugin ever starts. */
export function invalidConfigApply(): never {
  throw new Error('invalid plugin apply executed')
}

/**
 * Settle a plugin fiber without failing the case.
 * @param fiber - thenable returned by `Context.plugin`.
 * @returns the rejection reason, or `undefined` when the fiber started.
 */
export async function rejectionOf(fiber: ReturnType<Context['plugin']>): Promise<unknown> {
  return fiber.then(
    () => undefined,
    (error: unknown) => error,
  )
}

/**
 * Assert that a fiber rejection is the required-field config validation failure.
 * @param error - rejection reason observed from the fiber.
 */
export function expectRequiredConfigValidation(error: unknown): void {
  expect(error).toBeInstanceOf(ValidationError)
  expect(error).toHaveProperty('message', expect.stringMatching(/requiredValue/))
}

/**
 * Replace every companion loader for the duration of one case, then restore the originals.
 * @param create - builds the replacement loader for one companion path and index.
 * @param run - the case body that observes the replaced loaders.
 */
export async function withFakeCompanions(
  create: (path: string, index: number) => () => Promise<TestInvariantCompanion>,
  run: () => Promise<void>,
): Promise<void> {
  const mutable = testInvariantCompanions as Record<string, () => Promise<TestInvariantCompanion>>
  const originals = Object.entries(mutable)
  for (const [index, [path]] of originals.entries()) {
    mutable[path] = create(path, index)
  }
  try {
    await run()
  } finally {
    for (const [path, load] of originals) {
      mutable[path] = load
    }
  }
}

/**
 * Hold the first companion mid-startup while the case observes root plugin startup.
 * @param run - the case body, given the companion's started signal and its release.
 */
export async function withDelayedFirstCompanion(
  run: (control: { readonly started: Promise<void>; readonly release: () => void }) => Promise<void>,
): Promise<void> {
  const started = deferred()
  const release = deferred()
  await withFakeCompanions(
    (_path, index) => async () => ({
      name: `test-invariant-${index}`,
      inject: ['invariants'],
      async apply() {
        if (index === 0) {
          started.resolve()
          await release.promise
        }
        return () => {}
      },
    }),
    () => run({ started: started.promise, release: release.resolve }),
  )
}
