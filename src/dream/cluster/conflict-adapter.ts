/**
 * opencode-memory — ConflictClusterAdapter (v0.5.0)
 *
 * Adapts ConflictGraph components from v0.4.2 into MemoryCluster objects.
 * This is a pure adapter — it does NOT re-detect conflicts.
 * Each ConflictGraph connected component → one ConflictCluster.
 *
 * 1-node components are filtered out (a cluster needs at least 2 members).
 */

import type { ConflictGraph } from "../../conflict/types.js"
import { generateClusterId, type MemoryCluster } from "./types.js"

export class ConflictClusterAdapter {
  /**
   * Convert a ConflictGraph into MemoryCluster[].
   * Each component with >= 2 members becomes a "conflict" level cluster.
   * Empty graph → []. 1-node components → filtered.
   */
  fromGraph(graph: ConflictGraph): MemoryCluster[] {
    if (!graph || graph.components.length === 0) return []

    const clusters: MemoryCluster[] = []

    for (const component of graph.components) {
      // Filter 1-node components
      if (component.memories.length < 2) continue

      const conflictTypes = new Set(component.edges.map((e) => e.type))

      clusters.push({
        id: generateClusterId("conflict"),
        level: "conflict",
        members: [...component.memories].sort(),
        confidence: this.computeClusterConfidence(component.edges),
        metadata: {
          componentId: component.id,
          conflictTypes: Array.from(conflictTypes),
          edgeCount: component.edges.length,
        },
      })
    }

    return clusters
  }

  /**
   * Compute cluster confidence from the highest-confidence edge.
   * If no edges, use 0.5 as a conservative default.
   */
  private computeClusterConfidence(
    edges: Array<{ confidence: number }>,
  ): number {
    if (edges.length === 0) return 0.5
    return Math.max(...edges.map((e) => e.confidence))
  }
}