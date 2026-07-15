/**
 * opencode-memory — Generic metric math functions
 *
 * Pure mathematical functions for metric calculation.
 * Called by benchmark/metrics.ts (Metric<T> interface implementations).
 *
 * These are NOT the Metric<T> interface themselves — they are the
 * math primitives that Metric implementations delegate to.
 */

/** Precision: correct / total_saved */
export function precision(correct: number, total: number): number {
  return total > 0 ? correct / total : 0
}

/** Recall@K: hits_in_top_k / total_expected */
export function recallAtK(hits: number, _k: number, totalExpected: number): number {
  return totalExpected > 0 ? Math.min(hits, _k) / totalExpected : 0
}

/** F1: harmonic mean of precision and recall */
export function f1(prec: number, rec: number): number {
  return prec + rec > 0 ? (2 * prec * rec) / (prec + rec) : 0
}

/** ReductionRate: (before - after) / before */
export function reductionRate(before: number, after: number): number {
  return before > 0 ? (before - after) / before : 0
}
