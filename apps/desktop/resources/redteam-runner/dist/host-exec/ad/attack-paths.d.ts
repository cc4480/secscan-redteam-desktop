import type { AdEntry } from "./transport.js";
export interface GraphNode {
    dn: string;
    name: string;
    kind: "user" | "group" | "computer";
    sid: string;
}
export declare function sidOf(e: AdEntry): string;
/**
 * Compute shortest privilege paths to Tier-0 on the collected graph.
 * Edges: member->group, group->parent group, dangerous-ACL grant, delegation.
 * BFS runs BACKWARD from Tier-0 over reversed edges; dist[n] = hops to Tier-0.
 * Pure function over collected data — tested directly. COMPUTED ONLY.
 */
export declare function computeAttackPaths(nodes: GraphNode[], edges: {
    from: string;
    to: string;
    via: string;
}[], tier0Dns: Set<string>): {
    path: string[];
    via: string[];
}[];
