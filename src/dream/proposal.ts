/**
 * opencode-memory — ProposalMapper (v0.5.0)
 *
 * Translates ConsolidationCandidate (from Discovery Engine) into
 * RepairCandidate (from v0.3.3 RepairQueue) for human review or
 * automated execution.
 *
 * Mapping rules:
 *   "merge"   → type: "merge", action: "archive" (keep winner)
 *   "archive" → type: "lifecycle_archive", action: "archive"
 *   "split"   → type: "lifecycle_archive" (no RepairCandidate split support)
 *   "keep"    → (no candidate generated)
 */

import type { ConsolidationCandidate } from "./candidate/types.js"
import type { RepairCandidate, CandidateRisk } from "../repair/candidate.js"

export class ProposalMapper {
  /**
   * Convert a ConsolidationCandidate to a RepairCandidate.
   * Returns null if the action is "keep" (no action needed).
   */
  toRepairCandidate(candidate: ConsolidationCandidate): RepairCandidate | null {
    if (candidate.action === "keep") return null

    const now = Date.now()
    const firstTarget = candidate.targets[0] ?? "unknown"

    // Build a human-readable reason from evidence
    const reason = this.buildReason(candidate)

    // Determine risk level
    const risk = this.determineRisk(candidate)

    // Determine type
    const type = candidate.action === "merge"
      ? "lifecycle_archive" as const
      : "lifecycle_archive" as const

    return {
      id: `proposal_${candidate.id}`,
      type,
      action: "archive",
      source: firstTarget,
      reason,
      metadata: {
        size: 0,
        createdAt: now,
        lastModified: now,
      },
      preview: {
        title: `Discovery: ${candidate.action} ${firstTarget}`,
        description: `${candidate.action} candidate from cluster ${candidate.clusterId}`,
        sections: [
          `Action: ${candidate.action}`,
          `Targets: ${candidate.targets.join(", ")}`,
          `Confidence: ${candidate.confidence.toFixed(2)}`,
          `Expected Gain: ${candidate.expectedGain.toFixed(2)}`,
        ],
      },
      risk,
      status: "pending",
      createdAt: now,
    }
  }

  /**
   * Convert multiple candidates at once.
   */
  toRepairCandidates(candidates: ConsolidationCandidate[]): RepairCandidate[] {
    const results: RepairCandidate[] = []
    for (const c of candidates) {
      const mapped = this.toRepairCandidate(c)
      if (mapped) results.push(mapped)
    }
    return results
  }

  private buildReason(candidate: ConsolidationCandidate): string {
    const parts: string[] = [`Discovery: ${candidate.action}`]

    const evidence = candidate.evidence
    if (evidence.dominant) {
      parts.push(`dominated by ${evidence.dominant}`)
    }
    const lowWorth = evidence.members.filter((m) => m.worthiness < 0.2)
    if (lowWorth.length > 0) {
      parts.push(`low worthiness members: ${lowWorth.map((m) => m.filename).join(", ")}`)
    }

    return parts.join("; ") || `auto-discovered ${candidate.action} candidate`
  }

  private determineRisk(candidate: ConsolidationCandidate): CandidateRisk {
    if (candidate.riskHint < 0.2) return "low"
    if (candidate.riskHint < 0.5) return "medium"
    return "high"
  }
}