/**
 * opencode-memory — ProposalGenerator (v0.4.2)
 *
 * Generates resolution proposals for conflict edges. Does NOT modify
 * any files — only outputs proposals for the Repair Queue.
 *
 * See: docs/superpowers/specs/v0.4.2/04-resolution-engine.md
 */

import type { MemoryProvenance } from "../memory/provenance.js"
import type { ConflictEdge, ConflictResolutionProposal } from "./types.js"
import type { ValidationFinding } from "../validation/worthiness.js"
import { rankCandidates, type ConflictRankingInput } from "./ranking.js"

// ---------------------------------------------------------------------------
// ProposalGenerator
// ---------------------------------------------------------------------------

export interface ProposalContext {
  provenanceA?: MemoryProvenance
  provenanceB?: MemoryProvenance
  worthinessA?: number
  worthinessB?: number
  lifecycleA?: number
  lifecycleB?: number
  sourceTypeA?: string
  sourceTypeB?: string
  timestampA?: number
  timestampB?: number
}

export class ProposalGenerator {
  /**
   * Generate a resolution proposal for a single conflict edge.
   * Does NOT modify any files.
   */
  generate(
    edge: ConflictEdge,
    context: ProposalContext,
  ): ConflictResolutionProposal {
    // Duplicate → keep the higher-ranked one
    if (edge.type === "duplicate") {
      const ranked = this.toRankedInputs(context)
      const best = rankCandidates(ranked)[0]
      return {
        conflictId: edge.id,
        recommendation: best?.label === "A" ? "keep_a" : "keep_b",
        confidence: "high",
        reasoning: {
          higherWorthiness: "duplicate detected, keeping higher-ranked memory",
        },
        affectedMemories: [edge.source, edge.target],
      }
    }

    // Superseded → keep the newer one
    if (edge.type === "superseded") {
      return {
        conflictId: edge.id,
        recommendation: "keep_b",
        confidence: "high",
        reasoning: {
          newerLifecycle: "B supersedes A based on content signals and/or timestamp",
        },
        affectedMemories: [edge.source, edge.target],
      }
    }

    // Contradiction → ranking-based
    const ranked = this.toRankedInputs(context)
    const sorted = rankCandidates(ranked)

    if (sorted.length >= 2) {
      const best = sorted[0]
      const worst = sorted[1]

      // User source overrides
      if (best.sourceType === "user" && worst.sourceType !== "user") {
        return {
          conflictId: edge.id,
          recommendation: best.label === "A" ? "keep_a" : "keep_b",
          confidence: "high",
          reasoning: {
            strongerProvenance: "user-sourced memory overrides extraction",
          },
          affectedMemories: [edge.source, edge.target],
        }
      }

      // Significant worthiness gap
      if (best.worthinessScore > worst.worthinessScore + 0.15) {
        return {
          conflictId: edge.id,
          recommendation: best.label === "A" ? "keep_a" : "keep_b",
          confidence: "high",
          reasoning: {
            higherWorthiness: `significantly higher worthiness (${best.worthinessScore.toFixed(2)} vs ${worst.worthinessScore.toFixed(2)})`,
          },
          affectedMemories: [edge.source, edge.target],
        }
      }
    }

    // Default: manual review
    return {
      conflictId: edge.id,
      recommendation: "manual_review",
      confidence: "medium",
      reasoning: {
        higherWorthiness: "no clear winner based on available scores",
      },
      affectedMemories: [edge.source, edge.target],
    }
  }

  private toRankedInputs(ctx: ProposalContext): ConflictRankingInput[] {
    const inputs: ConflictRankingInput[] = []
    if (ctx.worthinessA !== undefined) {
      inputs.push({
        provenanceConfidence: ctx.provenanceA?.extraction?.confidenceScore ?? 0.5,
        lifecycleValidity: ctx.lifecycleA ?? 0.5,
        worthinessScore: ctx.worthinessA,
        timestamp: ctx.timestampA ?? ctx.provenanceA?.created.timestamp ?? 0,
        sourceType: ctx.sourceTypeA ?? ctx.provenanceA?.source.type ?? "unknown",
        label: "A",
      })
    }
    if (ctx.worthinessB !== undefined) {
      inputs.push({
        provenanceConfidence: ctx.provenanceB?.extraction?.confidenceScore ?? 0.5,
        lifecycleValidity: ctx.lifecycleB ?? 0.5,
        worthinessScore: ctx.worthinessB,
        timestamp: ctx.timestampB ?? ctx.provenanceB?.created.timestamp ?? 0,
        sourceType: ctx.sourceTypeB ?? ctx.provenanceB?.source.type ?? "unknown",
        label: "B",
      })
    }
    return inputs
  }
}

// ---------------------------------------------------------------------------
// Repair Integration
// ---------------------------------------------------------------------------

export function proposalToFinding(
  proposal: ConflictResolutionProposal,
  scope: "user" | "project" = "project",
): ValidationFinding | null {
  if (proposal.recommendation === "manual_review") return null

  return {
    id: `conflict_${Date.now().toString(36)}`,
    filename: proposal.affectedMemories[0],
    category: "contradiction" as const,
    severity: "warning",
    worthinessScore: 0,
    reasons: [
      {
        dimension: "lifecycle",
        score: 0,
        detail: proposal.reasoning.higherWorthiness
          ?? proposal.reasoning.newerLifecycle
          ?? proposal.reasoning.strongerProvenance
          ?? "conflict detected",
      },
    ],
    suggestedAction: {
      type: "archive",
      confidence: "medium",
    },
    createdAt: Date.now(),
    scope,
  }
}