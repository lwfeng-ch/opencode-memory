/**
 * opencode-memory — RiskEngine (v0.5.2)
 *
 * Multi-dimensional risk assessment for governance operations.
 * Consumes governance signals from the entire v0.4.x-v0.5.1 stack:
 * - worthiness (v0.4.1)
 * - conflict (v0.4.2)
 * - recall feedback (v0.4.3)
 * - fact evidence (v0.5.1)
 *
 * Auto-execute threshold: risk.score < 0.3 → autoExecutable = true
 */

import type { ConsolidationCandidate } from "../dream/candidate/types.js"
import type { RepairCandidate } from "../repair/candidate.js"
import type { RiskAssessment } from "./types.js"

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const AUTO_EXECUTE_THRESHOLD = 0.3

// ---------------------------------------------------------------------------
// RiskEngine
// ---------------------------------------------------------------------------

export interface RiskContext {
  factEvidence?: {
    hasDirectUserInput: boolean
    totalSessions: number
  }
  worthiness?: number
}

export class RiskEngine {
  /**
   * Assess risk for a ConsolidationCandidate (from Discovery Engine).
   */
  assessCandidate(
    candidate: ConsolidationCandidate,
    context?: RiskContext,
  ): RiskAssessment {
    return this.compute(
      candidate.action,
      candidate.confidence,
      candidate.targets.length,
      candidate.riskHint,
      context,
    )
  }

  /**
   * Assess risk for a RepairCandidate (from RepairQueue).
   */
  assessRepair(
    candidate: RepairCandidate,
    context?: RiskContext,
  ): RiskAssessment {
    const confidence = context?.worthiness ?? 0.5
    return this.compute(
      candidate.action,
      confidence,
      1,
      candidate.risk === "low" ? 0.1 : candidate.risk === "medium" ? 0.4 : 0.8,
      context,
    )
  }

  /**
   * Core risk computation.
   * Risk = (1 - confidence) × impact × blastRadius × reversibilityFactor
   */
  private compute(
    action: string,
    confidence: number,
    targetCount: number,
    riskHint: number,
    context?: RiskContext,
  ): RiskAssessment {
    // Impact: based on action type
    const impact = action === "delete" ? 0.9
      : action === "archive" ? 0.4
      : action === "merge" ? 0.5
      : 0.3

    // Blast radius: number of affected files
    const blastRadius = targetCount

    // Reversibility
    const reversibility: RiskAssessment["reversibility"] =
      action === "delete" ? "hard"
      : action === "archive" ? "easy"
      : "partial"

    // Confidence: use riskHint as a modifier
    const effectiveConfidence = Math.max(0, Math.min(1, confidence * (1 - riskHint * 0.5)))

    // Score = (1 - effectiveConfidence) × impact × (1 + blastRadius × 0.1) × reversibilityFactor
    const reversibilityFactor = reversibility === "easy" ? 0.5
      : reversibility === "partial" ? 0.8
      : 1.0

    const rawScore =
      (1 - effectiveConfidence) *
      impact *
      (1 + blastRadius * 0.1) *
      reversibilityFactor

    const score = Math.round(Math.max(0, Math.min(1, rawScore)) * 100) / 100

    // Fact evidence modifiers
    const factEvidence = {
      hasDirectUserInput: context?.factEvidence?.hasDirectUserInput ?? false,
      totalSessions: context?.factEvidence?.totalSessions ?? 0,
    }

    // If user directly confirmed, reduce risk
    const adjustedScore = factEvidence.hasDirectUserInput
      ? Math.max(0, score - 0.15)
      : score

    // Auto-executable if score < threshold
    const autoExecutable = adjustedScore < AUTO_EXECUTE_THRESHOLD

    // Label
    const label: RiskAssessment["label"] =
      adjustedScore < 0.3 ? "low"
      : adjustedScore < 0.6 ? "medium"
      : "high"

    return {
      score: Math.round(adjustedScore * 100) / 100,
      impact,
      confidence: effectiveConfidence,
      blastRadius,
      reversibility,
      factEvidence,
      autoExecutable,
      label,
    }
  }
}