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
