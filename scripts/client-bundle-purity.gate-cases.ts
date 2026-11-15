/** The purity-gate cases: which specifiers the module-edge gate admits. */

import { describe, expect, it } from 'vitest'
import { clientConfigs, purityResolveId } from './client-bundle-purity.harness-cases.ts'

describe('client bundle purity gate', () => {
  const resolveId = purityResolveId()

  it('leaves default externals and non-scoped specifiers alone', () => {
    expect(resolveId('@deepseek-ai/dsh-client-store')).toBeNull()
    expect(resolveId('@deepseek-ai/dsh-client-ui-slots')).toBeNull()
    expect(resolveId('@deepseek-ai/dsh-client-ui-primitives')).toBeNull()
    expect(resolveId('react')).toBeNull()
    expect(resolveId('zod')).toBeNull()
  })

  it('rejects the retired web-react platform package', () => {
    expect(() => resolveId('@deepseek-ai/dsh-client-web-react')).toThrow(/purity/)
    expect(() => resolveId('@deepseek-ai/dsh-client-web-react/store')).toThrow(/purity/)
  })

  it('lets inline-safe libraries inline', () => {
    expect(resolveId('@deepseek-ai/dsh-session/surface')).toBeNull()
    expect(resolveId('@deepseek-ai/dsh-brand')).toBeNull()
    expect(resolveId('@deepseek-ai/dsh-deque')).toBeNull()
    expect(resolveId('@deepseek-ai/dsh-util-values')).toBeNull()
    expect(resolveId('@deepseek-ai/dsh-token-meter/client')).toBeNull()
    expect(() => resolveId('@deepseek-ai/dsh-token-meter')).toThrow(/purity/)
    expect(() => resolveId('@deepseek-ai/dsh-token-meter/client/internal')).toThrow(/purity/)
    expect(resolveId('@deepseek-ai/dsh-host-open-in-app/shared')).toBeNull()
    expect(resolveId('@deepseek-ai/dsh-native-command/types')).toBeNull()
    expect(() => resolveId('@deepseek-ai/dsh-native-command')).toThrow('client bundle purity')
    expect(() => resolveId('@deepseek-ai/dsh-host-open-in-app')).toThrow(/purity/)
    expect(resolveId('@deepseek-ai/dsh-plugin-manager/registry')).toBeNull()
    expect(() => resolveId('@deepseek-ai/dsh-plugin-manager')).toThrow(/purity/)
    expect(() => resolveId('@deepseek-ai/dsh-plugin-manager/registry/internal')).toThrow(/purity/)
  })

  it('admits only the pure spill notice entry, not its Host policy', () => {
    expect(resolveId('@deepseek-ai/dsh-spill-policy/notice')).toBeNull()
    expect(resolveId('@deepseek-ai/dsh-output-retention')).toBeNull()
    expect(() => resolveId('@deepseek-ai/dsh-spill-policy')).toThrow(/purity/)
    expect(() => resolveId('@deepseek-ai/dsh-spill-policy/notice/internal')).toThrow(/purity/)
  })

  it('lets exact generated Remote contributions inline without admitting their package implementation', () => {
    expect(resolveId('@deepseek-ai/dsh-goal/remote')).toBeNull()
    expect(() => resolveId('@deepseek-ai/dsh-goal')).toThrow(/purity/)
    expect(() => resolveId('@deepseek-ai/dsh-goal/client')).toThrow(/purity/)
    expect(() => resolveId('@deepseek-ai/dsh-goal/remote/nested')).toThrow(/purity/)
  })

  it('throws on any other @deepseek-ai leak', () => {
    expect(() => resolveId('@deepseek-ai/dsh-agent')).toThrow(/purity/)
    expect(() => resolveId('@deepseek-ai/dsh-client-web')).toThrow(/purity/)
  })

  it('throws on cross-plugin value imports — bare plugin names and /client subpaths alike', () => {
    expect(() => resolveId('@deepseek-ai/dsh-client-connection')).toThrow(/purity/)
    expect(() => resolveId('@deepseek-ai/dsh-client-ui-session')).toThrow(/purity/)
    expect(() => resolveId('@deepseek-ai/dsh-client-ui-layout/client')).toThrow(/purity/)
  })

  it('admits package-specific requests only for the declaring bundle', () => {
    const requesting = purityResolveId('@deepseek-ai/dsh-api-session-controller')
    expect(requesting('@deepseek-ai/dsh-api-gateway/client')).toBeNull()
    expect(() => resolveId('@deepseek-ai/dsh-api-gateway/client')).toThrow(/purity/)
  })

  it('externalizes the baseline independently of each package manifest', () => {
    const requesting = clientConfigs()[0]?.deps as { neverBundle: (specifier: string) => boolean }
    const plain = clientConfigs('@deepseek-ai/dsh-client-connection')[0]?.deps as {
      neverBundle: (specifier: string) => boolean
    }

    expect(requesting.neverBundle('react')).toBe(true)
    expect(requesting.neverBundle('zod')).toBe(false)
    expect(plain.neverBundle('react')).toBe(true)
    expect(plain.neverBundle('@deepseek-ai/dsh-client-store')).toBe(true)
  })
})
