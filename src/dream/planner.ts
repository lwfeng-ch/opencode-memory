/**
 * opencode-memory — DreamRunner (v0.5.0)
 *
 * Orchestrates the full Discovery Engine pipeline:
 * Cluster → Evidence → Candidate → Proposal → RepairQueue
 *
 * Each phase is independently testable. The runner only coordinates.
 */

import type { ConflictGraph } from "../conflict/types.js"
import type { EvidenceReport, MemoryFile } from "./analyzer/evidence.js"
import type { ConsolidationCandidate } from "./candidate/types.js"
import { ClusterBuilder } from "./cluster/builder.js"
import { EvidenceCollector } from "./analyzer/evidence.js"
import { CandidateGenerator } from "./candidate/generator.js"
import type { DreamMode } from "./mode.js"

export interface DiscoveryReport {
  totalClusters: number
  totalCandidates: number
  candidates: ConsolidationCandidate[]
  duration: number
  errors: string[]
}

export class DreamRunner {
  private clusterBuilder: ClusterBuilder
  private evidenceCollector: EvidenceCollector
  private candidateGenerator: CandidateGenerator

  constructor() {
    this.clusterBuilder = new ClusterBuilder()
    this.evidenceCollector = new EvidenceCollector()
    this.candidateGenerator = new CandidateGenerator()
  }

  /**
   * Execute the full Discovery pipeline.
   * Mode parameter reserved for future DreamMode switching.
   */
  async run(
    conflictGraph: ConflictGraph,
    memories: MemoryFile[],
    _mode: DreamMode = "v0.5",
  ): Promise<DiscoveryReport> {
    const t0 = Date.now()
    const errors: string[] = []

    try {
      // Phase 1: Cluster Discovery
      const clusters = this.clusterBuilder.buildAll(
        conflictGraph,
        memories.map((m) => ({ filename: m.filename, content: m.content })),
        memories.map((m) => ({ filename: m.filename, content: m.content })),
      )

      // Phase 2: Evidence Collection
      const evidenceReports: EvidenceReport[] = []
      for (const cluster of clusters) {
        try {
          const evidence = this.evidenceCollector.collect(cluster, memories)
          evidenceReports.push(evidence)
        } catch (err) {
          errors.push(`evidence collection failed for ${cluster.id}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      // Phase 3: Candidate Generation
      const candidates = this.candidateGenerator.generate(clusters, evidenceReports)

      return {
        totalClusters: clusters.length,
        totalCandidates: candidates.length,
        candidates,
        duration: Date.now() - t0,
        errors,
      }
    } catch (err) {
      errors.push(`pipeline failed: ${err instanceof Error ? err.message : String(err)}`)
      return {
        totalClusters: 0,
        totalCandidates: 0,
        candidates: [],
        duration: Date.now() - t0,
        errors,
      }
    }
  }
}