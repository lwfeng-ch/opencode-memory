/**
 * opencode-memory — Memory Quality Score (v0.3.1)
 *
 * Aggregates 5 quality dimensions into a single QualityReport:
 *   Completeness (20%) — frontmatter field coverage
 *   Consistency (25%)  — duplicate detection
 *   Freshness (15%)    — age + recall tracking
 *   Noise (20%)        — placeholder/garbage/generic detection
 *   Retrievability (20%) — recall count distribution
 *
 * Re-exports QualityMemory type from quality.ts for convenience.
 */

import type { QualityMemory } from "./quality.js"
import {
  checkCompleteness,
  checkConsistency,
  checkFreshness,
  checkNoise,
  checkRetrievability,
} from "./quality.js"

// Re-export QualityMemory so consumers can import from quality-score.ts
export type { QualityMemory } from "./quality.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Quality report with overall score and per-dimension breakdown. */
export interface QualityReport {
  /** Overall quality score 0-100 (weighted average of dimensions) */
  overall: number
  /** Per-dimension scores 0-100 */
  dimensions: {
    completeness: number
    consistency: number
    freshness: number
    noise: number
    retrievability: number
  }
}

/** Interface for memory quality evaluators. */
export interface MemoryQualityEvaluator {
  evaluate(memories: QualityMemory[]): QualityReport
}

// ---------------------------------------------------------------------------
// Dimension weights
// ---------------------------------------------------------------------------

const WEIGHTS = {
  completeness: 0.20,
  consistency: 0.25,
  freshness: 0.15,
  noise: 0.20,
  retrievability: 0.20,
} as const

// ---------------------------------------------------------------------------
// DefaultMemoryQualityEvaluator
// ---------------------------------------------------------------------------

/**
 * Default implementation of MemoryQualityEvaluator.
 *
 * Computes 5 quality dimensions and aggregates them into a weighted
 * overall score. All dimension checks are pure functions from quality.ts.
 */
export class DefaultMemoryQualityEvaluator implements MemoryQualityEvaluator {
  evaluate(memories: QualityMemory[]): QualityReport {
    const now = Date.now()

    const dimensions = {
      completeness: checkCompleteness(memories),
      consistency: checkConsistency(memories),
      freshness: checkFreshness(memories, now),
      noise: checkNoise(memories),
      retrievability: checkRetrievability(memories),
    }

    const overall = Math.round(
      dimensions.completeness * WEIGHTS.completeness +
      dimensions.consistency * WEIGHTS.consistency +
      dimensions.freshness * WEIGHTS.freshness +
      dimensions.noise * WEIGHTS.noise +
      dimensions.retrievability * WEIGHTS.retrievability,
    )

    return { overall, dimensions }
  }
}
