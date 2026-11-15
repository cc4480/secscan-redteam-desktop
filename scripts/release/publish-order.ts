/**
 * The publish order a release family's members run in, and the peer edges that
 * order leaves unordered.
 */

import type { ReleaseMember } from './release-member.ts'

/**
 * Dependency sections a consumer must publish after, because npm resolves them
 * when the package is installed: publishing a consumer first would leave a
 * window where its own tree cannot be assembled.
 */
const INSTALL_SECTIONS = ['dependencies', 'optionalDependencies'] as const

/**
 * Peer declarations also order the publication, but they cannot constrain it.
 * npm never installs a peer on the package's behalf — an unmet peer is a
 * warning, not a resolution failure — and sibling packages legitimately declare
 * each other as peers, which makes these edges the ones that close cycles. They
 * order what they can and are dropped where they would deadlock.
 */
const PEER_SECTIONS = ['peerDependencies'] as const

/** One peer declaration the publish order leaves unordered. */
interface DroppedPeerEdge {
  readonly consumer: string
  /** The declared peer, which publishes after `consumer` or alongside it in a cycle. */
  readonly peer: string
}

/**
 * A family's publish order together with the ordering it could not honour.
 *
 * The dropped edges are part of the result rather than a detail of forming it:
 * a release drops real ordering constraints, and the operator reading the pack
 * log is the only one who can judge whether a newly dropped edge is expected.
 */
export interface PublishPlan {
  readonly order: readonly ReleaseMember[]
  /** Peer declarations left unordered, in the order the traversal reached them. */
  readonly droppedPeerEdges: readonly DroppedPeerEdge[]
}

/**
 * The family members one member declares in the given sections.
 * @param member - the dependent member.
 * @param byName - every family member by package name.
 * @param sections - manifest sections to read.
 * @returns Members of this family named there, sorted by name.
 */
function orderEdges(
  member: ReleaseMember,
  byName: ReadonlyMap<string, ReleaseMember>,
  sections: readonly string[],
): ReleaseMember[] {
  const edges: ReleaseMember[] = []
  for (const section of sections) {
    const dependencies = member.manifest[section]
    if (dependencies === null || typeof dependencies !== 'object' || Array.isArray(dependencies)) continue
    for (const name of Object.keys(dependencies)) {
      const dependency = byName.get(name)
      if (dependency !== undefined && dependency.name !== member.name) edges.push(dependency)
    }
  }
  return edges.sort((left, right) => left.name.localeCompare(right.name))
}

/**
 * Order members so every package publishes after the family members it
 * depends on, which is what makes a partial publication self-consistent: an
 * interrupted run leaves a prefix whose packages never point at something
 * absent from the registry.
 *
 * Install edges are honoured absolutely — a cycle among them is a defect this
 * reports rather than works around. Peer edges order what they can and are
 * dropped where honouring one would deadlock: sibling packages declare each
 * other as peers, and npm treats an unmet peer as a warning rather than a
 * resolution failure ([rationale](../../.agents/notes/implemented/process/2026-08-10-npm-release-sequences.md)).
 * Every dropped edge is reported, because dropping one is a decision about a
 * real release rather than an implementation detail.
 * @param id - the family's `--family` identifier, used in errors.
 * @param members - this family's members.
 * @returns The order, ties broken by name for determinism, and the peer edges it left unordered.
 */
export function planPublishOrder(id: string, members: readonly ReleaseMember[]): PublishPlan {
  const byName = new Map(members.map(member => [member.name, member]))
  const byNameSorted = [...members].sort((left, right) => left.name.localeCompare(right.name))
  const edges = (member: ReleaseMember, sections: readonly string[]): ReleaseMember[] =>
    orderEdges(member, byName, sections)

  // Install edges alone must be acyclic, and that is checked on its own graph:
  // a peer edge leading into an install edge would otherwise read as a cycle
  // where the install edges are perfectly orderable.
  const installVisiting = new Set<string>()
  const installDone = new Set<string>()
  const checkInstall = (member: ReleaseMember, path: readonly string[]): void => {
    if (installDone.has(member.name)) return
    if (installVisiting.has(member.name)) {
      throw new Error(`dependency cycle in release family ${id}: ${[...path, member.name].join(' -> ')}`)
    }
    installVisiting.add(member.name)
    for (const dependency of edges(member, INSTALL_SECTIONS)) checkInstall(dependency, [...path, member.name])
    installVisiting.delete(member.name)
    installDone.add(member.name)
  }
  for (const member of byNameSorted) checkInstall(member, [])

  // Emit the order over both kinds of edge. A node already on the stack closes
  // a cycle, and that cycle carries at least one peer edge because the install
  // edges were just proved acyclic — but the back edge that reaches the stacked
  // node is not necessarily the peer one, so the post-condition below decides
  // whether the emitted order survived.
  const ordered: ReleaseMember[] = []
  const droppedPeerEdges: DroppedPeerEdge[] = []
  const placed = new Set<string>()
  const onStack = new Set<string>()
  // Members reachable from one member through install edges. A peer edge is
  // dropped when the peer installs the member declaring it: honouring it would
  // emit a package before something it installs, and the install edge wins.
  const installClosure = (member: ReleaseMember): Set<string> => {
    const reached = new Set<string>()
    const walk = (current: ReleaseMember): void => {
      for (const dependency of edges(current, INSTALL_SECTIONS)) {
        if (reached.has(dependency.name)) continue
        reached.add(dependency.name)
        walk(dependency)
      }
    }
    walk(member)
    return reached
  }
  const visit = (member: ReleaseMember): void => {
    if (placed.has(member.name) || onStack.has(member.name)) return
    onStack.add(member.name)
    for (const dependency of edges(member, INSTALL_SECTIONS)) visit(dependency)
    for (const peer of edges(member, PEER_SECTIONS)) {
      if (installClosure(peer).has(member.name)) {
        droppedPeerEdges.push({ consumer: member.name, peer: peer.name })
        continue
      }
      // A peer already on the stack is an ancestor, so it publishes after this
      // member rather than before it: the edge is dropped, not honoured.
      if (onStack.has(peer.name)) droppedPeerEdges.push({ consumer: member.name, peer: peer.name })
      visit(peer)
    }
    onStack.delete(member.name)
    placed.add(member.name)
    ordered.push(member)
  }
  for (const member of byNameSorted) visit(member)

  // A cycle mixing both kinds of edge can put an install edge's target on the
  // stack, where the traversal skips it like a peer edge and emits a consumer
  // before something it installs. Nothing downstream can detect that, and it
  // would only surface as an unresolvable install for whoever consumes the
  // published packages, so the emitted order is checked against the edges it
  // exists to honour.
  const position = new Map(ordered.map((entry, index) => [entry.name, index]))
  for (const [index, member] of ordered.entries()) {
    for (const dependency of edges(member, INSTALL_SECTIONS)) {
      const dependencyIndex = position.get(dependency.name)
      if (dependencyIndex !== undefined && dependencyIndex < index) continue
      throw new Error(
        `release family ${id}: no publish order honours ${member.name} -> ${dependency.name};`
        + ' a cycle mixing peer and dependency declarations reaches this dependency through a peer edge',
      )
    }
  }
  return { order: ordered, droppedPeerEdges }
}
