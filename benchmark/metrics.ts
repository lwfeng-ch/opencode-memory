/**
 * opencode-memory — Benchmark Metrics
 *
 * Metric<T> interface + suite-specific implementations.
 * Delegates math to src/evaluation/metrics.ts.
 */

import type { EvaluationResult } from "../src/evaluation/types.js"
import { precision, recallAtK, f1, reductionRate } from "../src/evaluation/metrics.js"

export interface MetricResult {
  score: number
  details?: Record<string, unknown>
}

export interface Metric<T = unknown> {
  name: string
  evaluate(expected: T, actual: T): MetricResult
}

// ---------------------------------------------------------------------------
// Suite-specific metrics
// ---------------------------------------------------------------------------

/** Dedup: measures correct merge count */
export class DedupMetric implements Metric<{ merged_count: number; remaining: string[] }> {
  name = "ReductionRate"

  evaluate(expected: { merged_count: number; remaining: string[] }, actual: { merged_count: number; remaining: string[] }): MetricResult {
    const expectedReduction = expected.merged_count
    const actualReduction = actual.merged_count
    const score = actualReduction === expectedReduction
      ? 1.0
      : actualReduction / Math.max(expectedReduction, 1)
    return {
      score: Math.min(1, score),
      details: { expected_merges: expectedReduction, actual_merges: actualReduction },
    }
  }
}

/** Recall: measures hit rate of expected files in actual results */
export class RecallAtKMetric implements Metric<string[]> {
  name = "Recall@5"
  private k = 5

  evaluate(expected: string[], actual: string[]): MetricResult {
    const hit = actual.filter((f) => expected.includes(f))
    const miss = expected.filter((f) => !actual.includes(f))
    const score = expected.length > 0 ? hit.length / expected.length : 0
    return { score, details: { hit, miss } }
  }
}

/** Conflict: measures if correct memory was kept active */
export class ConflictResolutionMetric implements Metric<string> {
  name = "ConflictResolutionRate"

  evaluate(expected: string, actual: string): MetricResult {
    return {
      score: expected === actual ? 1.0 : 0.0,
      details: { expected_active: expected, actual_active: actual },
    }
  }
}

/** Extraction Pipeline: F1 score on extracted fields */
export class ExtractionPipelineMetric implements Metric<{ fields: Record<string, string> }> {
  name = "ExtractionF1"

  evaluate(expected: { fields: Record<string, string> }, actual: { fields: Record<string, string> }): MetricResult {
    const expectedKeys = Object.keys(expected.fields)
    const actualKeys = Object.keys(actual.fields)
    const correct = expectedKeys.filter((k) => actual.fields[k] === expected.fields[k])
    const p = precision(correct.length, Math.max(actualKeys.length, 1))
    const r = recallAtK(correct.length, 5, expectedKeys.length)
    const f1Score = f1(p, r)
    return { score: f1Score, details: { precision: p, recall: r, correct_fields: correct } }
  }
}

/** Forgetting: measures how many should-be-deprecated memories were actually deprecated */
export class ObsoleteRateMetric implements Metric<{ deprecated: number; should_deprecate: number }> {
  name = "ObsoleteRate"

  evaluate(_expected: { deprecated: number; should_deprecate: number }, actual: { deprecated: number; should_deprecate: number }): MetricResult {
    const score = actual.should_deprecate > 0
      ? actual.deprecated / actual.should_deprecate
      : 1.0
    return {
      score,
      details: { deprecated: actual.deprecated, should_deprecate: actual.should_deprecate },
    }
  }
}

// ---------------------------------------------------------------------------
// Metric factory
// ---------------------------------------------------------------------------

export function getMetricForSuite(suite: string): Metric<any> {
  switch (suite) {
    case "dedup": return new DedupMetric()
    case "recall": return new RecallAtKMetric()
    case "conflict": return new ConflictResolutionMetric()
    case "extraction_pipeline": return new ExtractionPipelineMetric()
    case "forgetting": return new ObsoleteRateMetric()
    default: throw new Error(`Unknown suite: ${suite}`)
  }
}
