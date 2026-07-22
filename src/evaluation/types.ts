/**
 * opencode-memory — Evaluation Layer types
 *
 * Unified evaluation result and context used by Audit, Benchmark,
 * and future Dashboard/Repair/CI Gate modules.
 */

import type { MemoryPluginConfig } from "../config.js"

/** Unified evaluation result. Used by Audit findings, Benchmark metrics, etc. */
export interface EvaluationResult {
  /** 0.0 ~ 1.0 */
  score: number
  /** Explanatory data (hit/miss lists, field comparisons, etc.) */
  details?: Record<string, unknown>
}

/** Context passed to evaluators (current time, config, etc.) */
export interface EvaluationContext {
  /** Date.now() — for age calculations */
  now: number
  /** Plugin config — for thresholds, limits */
  config: MemoryPluginConfig
}

// ---------------------------------------------------------------------------
// Quality Report types (v0.3.4 Phase 1 — Lifecycle-Aware)
// ---------------------------------------------------------------------------

/** Active memory quality — only scored on status=active files. */
export interface ActiveQualityReport {
  score: number
  count: number
  dimensions: {
    completeness: number
    consistency: number
    freshness: number
    noise: number
    retrievability: number
  }
}

/** Archive hygiene — checks integrity of archived memories. */
export interface ArchiveHygieneReport {
  score: number
  count: number
  dimensions: {
    indexConsistency: number
    frontmatter: number
    fileExists: number
    corruption: number
  }
}

/** Quality report v2 — dual-indicator with gate score. */
export interface QualityReportV2 {
  activeQuality: ActiveQualityReport
  archiveHygiene: ArchiveHygieneReport
  /** Quality Gate = activeQuality.score × (activeCount / (activeCount + archivedCount)) */
  gateScore: number
  /** [deprecated] Backward compatibility — equals gateScore */
  overall?: number
}
