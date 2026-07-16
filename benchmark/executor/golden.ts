/**
 * opencode-memory — Golden Benchmark Executor (v0.3.1)
 *
 * Wraps a runtime executor function + semantic comparator to produce
 * BenchmarkResults with comparison-based scores.
 *
 * Flow:
 *   GoldenCase → runtime executor → actual result
 *                                  ↓
 *               comparator (expected vs actual) → score → BenchmarkResult
 *
 * Unlike MockExecutor (which returns raw output for the runner to score),
 * GoldenExecutor does both execution and scoring in one step.
 */

import type { BenchmarkCase, BenchmarkResult } from "../runner.js"
import type { MemoryComparator, ComparableMemory, ComparisonResult } from "../../src/evaluation/comparison.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A golden benchmark case with human-verified expected output.
 * Extends BenchmarkCase with required metadata (model, reviewer, createdAt).
 */
export interface GoldenCase extends BenchmarkCase {
  metadata: {
    /** Model that produced the golden output */
    model?: string
    /** ISO timestamp when golden output was verified */
    createdAt: string
    /** Human reviewer who verified the golden output */
    reviewer?: string
    /** Source description */
    source?: string
    /** Brief description of what the case tests */
    description?: string
  }
}

/**
 * Runtime executor function — produces actual output from input.
 * In production, this calls the real extraction/recall/dream pipeline.
 * In tests, this is a mock function returning pre-defined outputs.
 */
export type RuntimeExecutorFn = (input: unknown) => Promise<unknown>

// ---------------------------------------------------------------------------
// GoldenExecutor
// ---------------------------------------------------------------------------

/**
 * Golden benchmark executor.
 *
 * Takes a runtime executor function and a semantic comparator.
 * For each golden case:
 *   1. Calls runtime(input) to get actual output
 *   2. Compares actual vs expected using the comparator
 *   3. Returns BenchmarkResult with comparison score
 *
 * The executor handles both ComparableMemory objects (uses compareMemory)
 * and plain strings/objects (falls back to compareText).
 */
export class GoldenExecutor {
  private readonly runtime: RuntimeExecutorFn
  private readonly comparator: MemoryComparator
  private readonly threshold: number

  constructor(
    runtime: RuntimeExecutorFn,
    comparator: MemoryComparator,
    threshold: number = 0.8,
  ) {
    this.runtime = runtime
    this.comparator = comparator
    this.threshold = threshold
  }

  /**
   * Execute an array of golden cases.
   * Returns BenchmarkResult[] with comparison-based scores.
   */
  async execute(cases: GoldenCase[]): Promise<BenchmarkResult[]> {
    const results: BenchmarkResult[] = []

    for (const case_ of cases) {
      const start = Date.now()
      try {
        const actual = await this.runtime(case_.input)
        const comparison = this.compareExpected(case_.expected, actual)
        results.push({
          caseId: case_.id,
          suite: case_.suite,
          passed: comparison.passed,
          actual,
          expected: case_.expected,
          score: comparison.score,
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

  /**
   * Compare expected vs actual using the semantic comparator.
   * Detects ComparableMemory objects and uses compareMemory;
   * falls back to compareText for plain strings/objects.
   */
  private compareExpected(expected: unknown, actual: unknown): ComparisonResult {
    if (isComparableMemory(expected) && isComparableMemory(actual)) {
      return this.comparator.compareMemory(expected, actual)
    }

    // Fall back to text comparison
    const expectedStr = typeof expected === "string" ? expected : JSON.stringify(expected)
    const actualStr = typeof actual === "string" ? actual : JSON.stringify(actual)
    const score = this.comparator.compareText(expectedStr, actualStr)

    return {
      score,
      fields: { content: score, name: 0, description: 0, type: 0 },
      passed: score >= this.threshold,
    }
  }
}

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

function isComparableMemory(obj: unknown): obj is ComparableMemory {
  if (typeof obj !== "object" || obj === null) return false
  return "content" in obj && typeof (obj as Record<string, unknown>).content === "string"
}
