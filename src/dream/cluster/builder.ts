/**
 * opencode-memory — ClusterBuilder (v0.5.0)
 *
 * Orchestrates the 3-level cluster discovery pipeline:
 * 1. Conflict — from ConflictGraph components (precise, architecture-first)
 * 2. Claim — from ClaimExtractor (exact subject/predicate match)
 * 3. Topic — from fingerprint.ts (fuzzy keyword similarity)
 *
 * Each level is independent — they discover different structures.
 * All results are returned in a single flat list.
 */

import type { ConflictGraph } from "../../conflict/types.js"
import { ConflictClusterAdapter } from "./conflict-adapter.js"
import { ClaimClusterBuilder, type ClaimClusterInput } from "./claim-cluster.js"
import { TopicClusterBuilder, type TopicClusterInput } from "./topic-cluster.js"
import type { MemoryCluster } from "./types.js"

export class ClusterBuilder {
  private conflictAdapter: ConflictClusterAdapter
  private claimBuilder: ClaimClusterBuilder
  private topicBuilder: TopicClusterBuilder

  constructor(topicThreshold: number = 0.3) {
    this.conflictAdapter = new ConflictClusterAdapter()
    this.claimBuilder = new ClaimClusterBuilder()
    this.topicBuilder = new TopicClusterBuilder(topicThreshold)
  }

  /**
   * Run all 3 levels of cluster discovery and return combined results.
   * Order: conflict → claim → topic (precision descending)
   */
  buildAll(
    conflictGraph: ConflictGraph,
    claimMemories: ClaimClusterInput[],
    topicMemories: TopicClusterInput[],
  ): MemoryCluster[] {
    const clusters: MemoryCluster[] = []

    // Level 1: Conflict (from ConflictGraph)
    const conflictClusters = this.conflictAdapter.fromGraph(conflictGraph)
    clusters.push(...conflictClusters)

    // Level 2: Claim (from ClaimExtractor)
    const claimClusters = this.claimBuilder.build(claimMemories)
    clusters.push(...claimClusters)

    // Level 3: Topic (from fingerprint.ts)
    const topicClusters = this.topicBuilder.build(topicMemories)
    clusters.push(...topicClusters)

    return clusters
  }
}