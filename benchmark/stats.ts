/**
 * opencode-memory — Benchmark Statistics
 *
 * Pure functions for computing summary statistics from repeated benchmark runs.
 * Uses normal approximation for confidence intervals (v0.3.2).
 * v0.3.3 will switch to Student-t distribution for small n.
 */

/** Result of computing summary statistics from a set of scores. */
export interface StatsResult {
  mean: number
  stddev: number
  /** 95% confidence interval (normal approximation) */
  ci95: [number, number]
  n: number
  scores: number[]
}

/**
 * Compute summary statistics from an array of scores.
 *
 * Pure function — no side effects, no I/O. Returns a copy of the input
 * scores array so the caller cannot mutate the result's internal state.
 *
 * - n=0: returns zeros
 * - n=1: stddev=0, ci95 collapses to the single score
 * - n>=2: population variance, normal approximation for CI95
 */
export function computeStats(scores: number[]): StatsResult {
  const n = scores.length

  if (n === 0) {
    return { mean: 0, stddev: 0, ci95: [0, 0], n: 0, scores: [] }
  }

  if (n === 1) {
    const v = scores[0]
    return { mean: v, stddev: 0, ci95: [v, v], n: 1, scores: [v] }
  }

  const mean = scores.reduce((a, b) => a + b, 0) / n
  const variance = scores.reduce((s, x) => s + (x - mean) ** 2, 0) / n
  const stddev = Math.sqrt(variance)

  // Normal approximation (valid for large n; for n=3 this is optimistic)
  // v0.3.3 will switch to Student-t distribution
  const margin = 1.96 * stddev / Math.sqrt(n)

  return {
    mean,
    stddev,
    ci95: [mean - margin, mean + margin],
    n,
    scores: [...scores],
  }
}
