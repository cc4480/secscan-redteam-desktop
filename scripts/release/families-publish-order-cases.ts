/** Publish ordering: install edges, peer edges, cycles, and dev-dependency exclusion. */

import { describe, expect, it } from 'vitest'
import { releaseFamily } from './families.ts'
import { member } from './families-fixtures-cases.ts'

describe('release families', () => {
  it('publishes a dependency before its consumer, and orders ties by name', () => {
    const dsh = releaseFamily('dsh')
    const members = [
      member('packages/a/consumer', '@deepseek-ai/dsh-consumer', { dependencies: { '@deepseek-ai/dsh-library': 'workspace:^' } }),
      member('packages/a/library', '@deepseek-ai/dsh-library'),
      member('packages/a/zebra', '@deepseek-ai/dsh-zebra'),
    ]

    expect(dsh.publishOrder(members).order.map(entry => entry.name)).toEqual([
      '@deepseek-ai/dsh-library',
      '@deepseek-ai/dsh-consumer',
      '@deepseek-ai/dsh-zebra',
    ])
  })

  it('reports a runtime dependency cycle instead of emitting an arbitrary order', () => {
    const dsh = releaseFamily('dsh')
    const members = [
      member('packages/a/left', '@deepseek-ai/dsh-left', { dependencies: { '@deepseek-ai/dsh-right': 'workspace:^' } }),
      member('packages/a/right', '@deepseek-ai/dsh-right', { dependencies: { '@deepseek-ai/dsh-left': 'workspace:^' } }),
    ]

    expect(() => { dsh.publishOrder(members) }).toThrow(/dependency cycle/)
  })

  it('publishes a peer before its consumer', () => {
    const dsh = releaseFamily('dsh')
    const members = [
      member('packages/a/consumer', '@deepseek-ai/dsh-consumer', { peerDependencies: { '@deepseek-ai/dsh-zebra': 'workspace:^' } }),
      member('packages/a/zebra', '@deepseek-ai/dsh-zebra'),
    ]

    // Name order alone would place the consumer first; the peer edge moves it.
    expect(dsh.publishOrder(members).order.map(entry => entry.name)).toEqual([
      '@deepseek-ai/dsh-zebra',
      '@deepseek-ai/dsh-consumer',
    ])
  })

  it('orders around a peer cycle rather than refusing to publish, and reports the edge it dropped', () => {
    const dsh = releaseFamily('dsh')
    const members = [
      member('packages/a/left', '@deepseek-ai/dsh-left', { peerDependencies: { '@deepseek-ai/dsh-right': 'workspace:^' } }),
      member('packages/a/right', '@deepseek-ai/dsh-right', { peerDependencies: { '@deepseek-ai/dsh-left': 'workspace:^' } }),
    ]

    // Sibling packages declare each other as peers, and npm treats an unmet peer
    // as a warning, so this pair has to publish rather than fail the release.
    const plan = dsh.publishOrder(members)
    expect(plan.order.map(entry => entry.name)).toEqual([
      '@deepseek-ai/dsh-right',
      '@deepseek-ai/dsh-left',
    ])
    // One of the two edges has to give, and which one it is belongs in the log.
    expect(plan.droppedPeerEdges).toEqual([
      { consumer: '@deepseek-ai/dsh-right', peer: '@deepseek-ai/dsh-left' },
    ])
  })

  it('honours an install edge even when a peer cycle surrounds it', () => {
    const dsh = releaseFamily('dsh')
    const members = [
      member('packages/a/base', '@deepseek-ai/dsh-base', { peerDependencies: { '@deepseek-ai/dsh-consumer': 'workspace:^' } }),
      member('packages/a/consumer', '@deepseek-ai/dsh-consumer', {
        dependencies: { '@deepseek-ai/dsh-base': 'workspace:^' },
        peerDependencies: { '@deepseek-ai/dsh-base': 'workspace:^' },
      }),
    ]

    // The install edge is absolute: base publishes first, and the peer edge that
    // would reverse it is the one dropped.
    const plan = dsh.publishOrder(members)
    expect(plan.order.map(entry => entry.name)).toEqual([
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-consumer',
    ])
    expect(plan.droppedPeerEdges).toEqual([
      { consumer: '@deepseek-ai/dsh-base', peer: '@deepseek-ai/dsh-consumer' },
    ])
  })

  it('refuses an order that would publish a consumer before a dependency it installs', () => {
    const dsh = releaseFamily('dsh')
    const members = [
      member('packages/a/alpha', '@deepseek-ai/dsh-alpha', { peerDependencies: { '@deepseek-ai/dsh-bravo': 'workspace:^' } }),
      member('packages/a/bravo', '@deepseek-ai/dsh-bravo', { peerDependencies: { '@deepseek-ai/dsh-charlie': 'workspace:^' } }),
      member('packages/a/charlie', '@deepseek-ai/dsh-charlie', { dependencies: { '@deepseek-ai/dsh-alpha': 'workspace:^' } }),
    ]

    // A cycle of two peer edges closed by one install edge: dropping a peer edge
    // would order this, and the traversal drops the install edge instead. That
    // order would publish charlie before the alpha it installs, so it is refused
    // here rather than published.
    expect(() => { dsh.publishOrder(members) }).toThrow(/no publish order honours @deepseek-ai\/dsh-charlie -> @deepseek-ai\/dsh-alpha/)
  })

  it('ignores devDependencies when ordering', () => {
    const dsh = releaseFamily('dsh')
    const members = [
      member('packages/a/alpha', '@deepseek-ai/dsh-alpha', { devDependencies: { '@deepseek-ai/dsh-zebra': 'workspace:^' } }),
      member('packages/a/zebra', '@deepseek-ai/dsh-zebra'),
    ]

    // A dev dependency is absent from the published package, so it must not move
    // the consumer behind it.
    expect(dsh.publishOrder(members).order.map(entry => entry.name)).toEqual([
      '@deepseek-ai/dsh-alpha',
      '@deepseek-ai/dsh-zebra',
    ])
  })
})
