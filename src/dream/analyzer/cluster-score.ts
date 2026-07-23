/**
 * opencode-memory — ClusterScoreEngine (v0.5.0)
 *
 * Scores pairwise relationships within a cluster:
 * - compatibility: same claim values are compatible (can merge)
 * - dominance: one member clearly outranks others
 * - redundancy: how much duplicate content exists
 */

import type { MemoryCluster } from "../cluster/types.js"
import type { EvidenceReport } from "./evidence.js"

export class ClusterScoreEngine {
  /**
   * Score a cluster's internal structure.
   */
  score(
    cluster: MemoryCluster,
    evidence: EvidenceReport,
  ): {
    compatibility: number
    dominance: number
    redundancy: number
  } {
    const members = evidence.members
    const n = members.length

    if (n < 2) {
      return { compatibility: 1, dominance: 0, redundancy: 0 }
    }

    // Dominance: if a dominant member exists, score = how dominant
    const dominance = evidence.dominant
      ? 1.0
      : 0

    // Redundancy: based on worthiness uniformity
    // If all members have similar worthiness, lower redundancy
    const worthinessValues = members.map((m) => m.worthiness)
    const maxW = Math.max(...worthinessValues)
    const minW = Math.min(...worthinessValues)
    const spread = maxW > 0 ? (maxW - minW) / maxW : 0
    const redundancy = spread > 0.5 ? 0.7 : 0.3

    // Compatibility: based on cluster level
    // Conflict clusters are inherently incompatible
    // Claim clusters may be compatible if values don't conflict
    // Topic clusters are neutral
    let compatibility = 0.5
    if (cluster.level === "conflict") {
      compatibility = 0.2
    } else if (cluster.level === "claim") {
      // Check metadata for values
      const values = cluster.metadata.values as string[] | undefined
      if (values && new Set(values).size === values.length) {
        // All values are distinct → potential conflict
        compatibility = 0.3
      } else {
        compatibility = 0.8
      }
    }

    return {
      compatibility,
      dominance,
      redundancy,
    }
  }
}