/** The module-request cases: which externals and injections a client row may declare. */

import { describe, expect, it } from 'vitest'
import { collectClientPackageViolations } from './verify-client-packages.ts'
import { declaration, facts } from './verify-client-packages.fixtures.ts'

describe('module requests', () => {
  it('rejects runtime requests from one client feature package to another dynamic row', () => {
    const ui = declaration('ui', {
      external: ['@deepseek-ai/dsh-client-slots/client'],
      runtimeSourceUses: {
        '@deepseek-ai/dsh-client-slots': ['packages/client/ui/src/client/index.ts'],
      },
    })
    const slots = declaration('slots')
    expect(collectClientPackageViolations(facts([], { declarations: [ui, slots] }))).toEqual([
      ui.manifest + ': client feature package requests runtime external '
      + '"@deepseek-ai/dsh-client-slots/client"; import shared types only or call an injected Cordis service',
    ])
  })

  it('rejects stale externals and accepts a runtime import outside client feature packages', () => {
    const gateway = {
      ...declaration('@deepseek-ai/dsh-api-gateway'), manifest: 'packages/api/gateway/package.json',
    }
    const stale = { ...declaration('@deepseek-ai/dsh-api-stale', {
      external: ['@deepseek-ai/dsh-api-gateway/client'],
    }), manifest: 'packages/api/stale/package.json' }
    const live = { ...declaration('@deepseek-ai/dsh-api-live', {
      external: ['@deepseek-ai/dsh-api-gateway/client'],
      runtimeSourceUses: {
        '@deepseek-ai/dsh-api-gateway': ['packages/api/live/src/client/index.ts'],
      },
      runtimeSourceSpecifiers: {
        '@deepseek-ai/dsh-api-gateway/client': ['packages/api/live/src/client/index.ts'],
      },
    }), manifest: 'packages/api/live/package.json' }
    expect(collectClientPackageViolations(facts([], {
      declarations: [gateway, stale, live],
    }))).toEqual([
      stale.manifest + ': dsh.client.external "@deepseek-ai/dsh-api-gateway/client"'
      + ' has no runtime import or re-export in production source; remove the stale declaration',
    ])
  })

  it('requires the exact external subpath to be imported at runtime', () => {
    const gateway = {
      ...declaration('@deepseek-ai/dsh-api-gateway'), manifest: 'packages/api/gateway/package.json',
    }
    const subject = { ...declaration('@deepseek-ai/dsh-api-session-controller', {
      external: ['@deepseek-ai/dsh-api-gateway/client'],
      runtimeSourceUses: {
        '@deepseek-ai/dsh-api-gateway': ['packages/api/session-controller/src/client/index.ts'],
      },
      runtimeSourceSpecifiers: {
        '@deepseek-ai/dsh-api-gateway/remote': ['packages/api/session-controller/src/client/index.ts'],
      },
    }), manifest: 'packages/api/session-controller/package.json' }
    expect(collectClientPackageViolations(facts([], { declarations: [gateway, subject] }))).toEqual([
      subject.manifest + ': dsh.client.external "@deepseek-ai/dsh-api-gateway/client"'
      + ' has no runtime import or re-export in production source; remove the stale declaration',
    ])
  })

  it('rejects an explicit baseline request', () => {
    const ui = declaration('ui', { external: ['react'] })
    expect(collectClientPackageViolations(facts([], {
      declarations: [ui],
      platformModules: ['react'],
    }))).toEqual([
      ui.manifest + ': dsh.client.external repeats baseline module "react"; remove the explicit declaration',
    ])
  })

  it('rejects duplicates, empty values, self-requests, and missing suppliers', () => {
    const ui = declaration('ui', {
      external: ['', '@deepseek-ai/dsh-client-ui', '@deepseek-ai/dsh-missing', '@deepseek-ai/dsh-missing'],
      inject: ['', '@deepseek-ai/dsh-a', '@deepseek-ai/dsh-a'],
    })
    const found = collectClientPackageViolations(facts([], { declarations: [ui] }))
    expect(found).toHaveLength(6)
    expect(found.join('\n')).toContain('dsh.client.external contains an empty value')
    expect(found.join('\n')).toContain('dsh.client.inject contains an empty value')
    expect(found.join('\n')).toContain('names its own row')
    expect(found.join('\n')).toContain('has no supplier')
  })

  it('rejects synchronous module-request cycles but ignores inject cycles', () => {
    const a = { ...declaration('@deepseek-ai/dsh-api-a', {
      external: ['@deepseek-ai/dsh-api-b'],
      inject: ['@deepseek-ai/dsh-api-b'],
      runtimeSourceUses: { '@deepseek-ai/dsh-api-b': ['packages/api/a/src/client.ts'] },
      runtimeSourceSpecifiers: { '@deepseek-ai/dsh-api-b': ['packages/api/a/src/client.ts'] },
    }), manifest: 'packages/api/a/package.json' }
    const b = { ...declaration('@deepseek-ai/dsh-api-b', {
      external: ['@deepseek-ai/dsh-api-a'],
      inject: ['@deepseek-ai/dsh-api-a'],
      runtimeSourceUses: { '@deepseek-ai/dsh-api-a': ['packages/client/b/src/client.ts'] },
      runtimeSourceSpecifiers: { '@deepseek-ai/dsh-api-a': ['packages/client/b/src/client.ts'] },
    }), manifest: 'packages/api/b/package.json' }
    const found = collectClientPackageViolations(facts([], { declarations: [a, b] }))
    expect(found).toHaveLength(1)
    expect(found[0]).toContain('synchronous dsh.client.external cycle')
  })
})
