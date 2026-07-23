/**
 * opencode-memory — CandidateGenerator (v0.5.0)
 *
 * Generates ConsolidationCandidate objects from clusters and evidence.
 *
 * Rule engine (non-LLM):
 * 1. Conflict cluster with dominant + low worthiness members → archive
 * 2. Conflict cluster with all low worthiness → archive
 * 3. Conflict cluster with no dominant → split (mark conflict)
 * 4. Conflict cluster with all high worthiness → keep (no action)
 */

import type { MemoryCluster } from "../cluster/types.js"
import type { EvidenceReport } from "../analyzer/evidence.js"
import {
  type ConsolidationCandidate,
  type CandidateAction,
  generateCandidateId,
} from "./types.js"

export class CandidateGenerator {
  /**
   * Generate ConsolidationCandidates from clusters and their evidence.
   * Only conflict-level clusters are processed in Phase 1.
   */
  generate(
    clusters: MemoryCluster[],
    evidenceReports: EvidenceReport[],
  ): ConsolidationCandidate[] {
    const evidenceMap = new Map(
      evidenceReports.map((r) => [r.clusterId, r]),
    )
    const candidates: ConsolidationCandidate[] = []

    for (const cluster of clusters) {
      const evidence = evidenceMap.get(cluster.id)
      if (!evidence) continue

      // Phase 1: only process conflict-level clusters
      if (cluster.level !== "conflict") continue

      const candidate = this.evaluateConflictCluster(cluster, evidence)
      if (candidate) {
        candidates.push(candidate)
      }
    }

    // Sort by confidence descending
    return candidates.sort((a, b) => b.confidence - a.confidence)
  }

  /**
   * Evaluate a conflict-level cluster using the rule engine.
   */
  private evaluateConflictCluster(
    cluster: MemoryCluster,
    evidence: EvidenceReport,
  ): ConsolidationCandidate | null {
    const { action, targets, confidence, expectedGain, riskHint } =
      this.applyRules(cluster, evidence)

    // "keep" means no action — skip generating a candidate
    if (action === "keep") return null

    return {
      id: generateCandidateId(),
      clusterId: cluster.id,
      action,
      targets,
      evidence,
      expectedGain,
      riskHint,
      confidence,
    }
  }

  /**
   * Rule engine for conflict clusters.
   *
   * Rules:
   * 1. Dominant + any member worthiness < 0.2 → archive low-worthiness members
   * 2. All members worthiness < 0.2 → archive all
   * 3. No dominant, mixed worthiness → split (mark conflict, no auto action)
   * 4. All members worthiness >= 0.5 → keep (no action needed)
   * 5. Default → split
   */
  private applyRules(
    cluster: MemoryCluster,
    evidence: EvidenceReport,
  ): {
    action: CandidateAction
    targets: string[]
    confidence: number
    expectedGain: number
    riskHint: number
  } {
    const members = evidence.members

    // Rule 4: all high worthiness → keep
    if (members.every((m) => m.worthiness >= 0.5)) {
      return {
        action: "keep",
        targets: [],
        confidence: 0.9,
        expectedGain: 0,
        riskHint: 0,
      }
    }

    // Rule 2: all low worthiness → archive all
    if (members.every((m) => m.worthiness < 0.2)) {
      return {
        action: "archive",
        targets: cluster.members,
        confidence: 0.85,
        expectedGain: 0.6,
        riskHint: 0.1,
      }
    }

    // Rule 1: dominant + low worthiness members → archive the low ones
    if (evidence.dominant) {
      const lowWorthiness = members
        .filter((m) => m.filename !== evidence.dominant && m.worthiness < 0.2)
        .map((m) => m.filename)

      if (lowWorthiness.length > 0) {
        return {
          action: "archive",
          targets: lowWorthiness,
          confidence: 0.8,
          expectedGain: 0.5,
          riskHint: 0.15,
        }
      }
    }

    // Rule 3/5: default → split
    return {
      action: "split",
      targets: cluster.members,
      confidence: 0.6,
      expectedGain: 0.3,
      riskHint: 0.5,
    }
  }
}