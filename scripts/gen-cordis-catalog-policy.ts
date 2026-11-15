import type { CordisCatalogPolicy } from '@deepseek-ai/dsh-typert-generator'
import { FOUNDATION_TYPE_NAMES, TYPE_LINK_EXEMPTIONS } from './gen-cordis-catalog-foundation.ts'
import { LINK_MAP } from './gen-cordis-catalog-link-map.ts'

/** Repository data policy consumed by the Cordis catalog projector. */
export const CORDIS_CATALOG_POLICY: CordisCatalogPolicy = {
  linkedTypePages: LINK_MAP,
  foundationTypeNames: FOUNDATION_TYPE_NAMES,
  typeLinkExemptions: TYPE_LINK_EXEMPTIONS,
  runtimeServiceExclusions: new Set(['cordisInspect', 'dynamicCordisRunner']),
  runtimeServices: [{
    key: 'timer',
    type: 'TimerService',
    abstract: false,
    doc: 'Disposable timer helpers mixed into Cordis contexts.',
    source: 'vendor/timer/src/index.ts:12',
    methods: [
      {
        signature: 'timeout(callback: () => void, delay: number): () => void',
        jsDoc: '/** Run a callback once and return its disposer. */',
      },
      {
        signature: 'timeout(delay: number): Promise<void>',
        jsDoc: '/** Resolve after a delay; disposal rejects the pending promise. */',
      },
      {
        signature: 'interval(callback: () => void, delay: number): () => void',
        jsDoc: '/** Run a callback repeatedly and return its disposer. */',
      },
      {
        signature: 'interval<R = any>(delay: number): AsyncIterableIterator<void, R, void>',
        jsDoc: '/** Return an async iterator of timer ticks. */',
      },
      {
        signature: 'throttle<F extends (...args: any[]) => void>(callback: F, delay: number, noTrailing?: boolean): F & { dispose: () => void }',
        jsDoc: '/** Return a throttled function whose timer is disposed with the current fiber. */',
      },
      {
        signature: 'debounce<F extends (...args: any[]) => void>(callback: F, delay: number): F & { dispose: () => void }',
        jsDoc: '/** Return a debounced function whose timer is disposed with the current fiber. */',
      },
    ],
  }],
  inheritedEvents: [
    { name: 'internal/plugin', summary: 'A plugin fiber was created.', source: 'vendor/cordis/src/events.ts:331' },
    { name: 'internal/status', summary: 'A fiber changed lifecycle state.', source: 'vendor/cordis/src/events.ts:333' },
    { name: 'internal/service', summary: 'Interception hook for a service binding (no core producer).', source: 'vendor/cordis/src/events.ts:341' },
    { name: 'internal/update', summary: 'Waterfall: a fiber config update is being applied.', source: 'vendor/cordis/src/events.ts:343' },
    { name: 'internal/config', summary: 'Waterfall: a fiber config is being resolved before validation.', source: 'vendor/cordis/src/events.ts:339' },
    { name: 'internal/get', summary: 'Waterfall: a service is being read from the store.', source: 'vendor/cordis/src/events.ts:345' },
    { name: 'internal/set', summary: 'Waterfall: a service is being written to the store.', source: 'vendor/cordis/src/events.ts:347' },
    { name: 'internal/listener', summary: 'A listener was registered.', source: 'vendor/cordis/src/events.ts:349' },
    { name: 'internal/dispatch', summary: 'An event is being dispatched to listeners.', source: 'vendor/cordis/src/events.ts:351' },
    { name: 'exit', summary: 'The process is exiting on a signal.', source: 'vendor/loader/src/index.ts:25' },
    { name: 'loader/config-update', summary: 'The loader config tree changed.', source: 'vendor/loader/src/index.ts:26' },
    { name: 'loader/entry-init', summary: 'A config entry is being initialized.', source: 'vendor/loader/src/index.ts:27' },
    { name: 'loader/partial-dispose', summary: 'An entry is being partially disposed on reload.', source: 'vendor/loader/src/index.ts:28' },
    { name: 'loader/patch-context', summary: 'A context is being patched during a reload.', source: 'vendor/loader/src/index.ts:41' },
    { name: 'loader/volatile-update', summary: 'Volatile config values committed into the running fiber without a remount; dispatched to the owning fiber only.', source: 'vendor/loader/src/index.ts:34' },
  ],
  inheritedServices: [
    { name: 'ctx.on / ctx.once', summary: 'Register an event listener (disposable).', source: 'vendor/cordis/src/events.ts:34' },
    { name: 'ctx.emit / ctx.parallel / ctx.serial / ctx.bail / ctx.waterfall', summary: 'Dispatch an event (sync / awaited / first-bail / short-circuit chain).', source: 'vendor/cordis/src/events.ts:34' },
    { name: 'ctx.plugin / ctx.inject', summary: 'Load a plugin / declare required services.', source: 'vendor/cordis/src/registry.ts:164' },
    { name: 'ctx.effect', summary: 'Register a disposable side effect tied to the fiber.', source: 'vendor/cordis/src/fiber.ts:9' },
    { name: 'ctx.get / ctx.set / ctx.provide / ctx.accessor / ctx.mixin', summary: 'Low-level service-store access and binding.', source: 'vendor/cordis/src/reflect.ts:7' },
    { name: 'ctx.extend / ctx.isolate / ctx.intercept', summary: 'Derive a child context (scoped services / isolation / interception).', source: 'vendor/cordis/src/context.ts:42' },
    { name: 'ctx.root / ctx.fiber / ctx.registry / ctx.reflect / ctx.events / ctx.logger', summary: 'Ambient handles onto the running context graph.', source: 'vendor/cordis/src/context.ts:16' },
    { name: 'ctx.timer (+ interval / timeout / throttle / debounce)', summary: 'Disposable timer helpers. The `timer` key is provided at runtime; the four supported helpers are mixed onto ctx directly (declared via Pick).', source: 'vendor/timer/src/index.ts:4' },
    { name: 'ctx.loader', summary: 'The config Loader that booted the app (present under the loader).', source: 'vendor/loader/src/index.ts:30' },
  ],
}
