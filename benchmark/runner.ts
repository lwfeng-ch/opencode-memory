/**
 * opencode-memory — Benchmark Runner
 *
 * Orchestrates benchmark case execution via an executor strategy.
 * Runner = orchestration, Executor = per-case execution.
 */

export type BenchmarkSuite = "extraction_pipeline" | "recall" | "dedup" | "forgetting" | "conflict"
export type BenchmarkMode = "mock" | "golden" | "real"

export interface BenchmarkCase {
  id: string
  version: string
  suite: BenchmarkSuite
  input: unknown
  expected: unknown
  metadata?: {
    source?: string
    description?: string
    createdAt?: string
  }
}

export interface BenchmarkResult {
  caseId: string
  suite: BenchmarkSuite
  passed: boolean
  actual: unknown
  expected: unknown
  score: number
  durationMs: number
  error?: string
  // v0.3.2 fields (optional — only populated in real mode)
  /** Actual run count (when repeated) */
  runs?: number
  /** Per-run scores [0.82, 0.87, 0.79] */
  scores?: number[]
  /** Standard deviation across runs */
  stddev?: number
  /** 95% confidence interval [lower, upper] */
  ci95?: [number, number]
  /** How many runs hit cache */
  cacheHits?: number
  /** How many runs called LLM */
  llmCalls?: number
  /** Comparator mode used */
  comparatorMode?: "hybrid-4layer" | "legacy-3layer"
  /** Model name used */
  modelUsed?: string
  /** Token usage */
  tokensUsed?: { input: number; output: number }
}

export interface BenchmarkExecutor {
  execute(case_: BenchmarkCase): Promise<unknown>
}

export interface BenchmarkRunner {
  run(cases: BenchmarkCase[], executor: BenchmarkExecutor): Promise<BenchmarkResult[]>
}

export class DefaultBenchmarkRunner implements BenchmarkRunner {
  async run(cases: BenchmarkCase[], executor: BenchmarkExecutor): Promise<BenchmarkResult[]> {
    const results: BenchmarkResult[] = []

    for (const case_ of cases) {
      const start = Date.now()
      try {
        const actual = await executor.execute(case_)
        const metric = getMetricForSuite(case_.suite)
        const metricResult = metric.evaluate(case_.expected, actual)
        results.push({
          caseId: case_.id,
          suite: case_.suite,
          passed: metricResult.score >= 0.8,
          actual,
          expected: case_.expected,
          score: metricResult.score,
          durationMs: Date.now() - start,
        })
      } catch (error) {
        results.push({
          caseId: case_.id,
          suite: case_.suite,
          passed: false,
          actual: null,
          expected: case_.expected,
          score: 0,
          durationMs: Date.now() - start,
          error: String(error),
        })
      }
    }
    return results
  }
}

// Import here to avoid circular deps
import type { Metric } from "./metrics.js"
import { getMetricForSuite } from "./metrics.js"
