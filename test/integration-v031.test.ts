/**
 * opencode-memory — v0.3.1 Integration Tests
 *
 * End-to-end tests that verify the full v0.3.1 flow:
 *   Load golden dataset → Run GoldenExecutor → Generate report → Verify intelligence_score
 *   Load memory files → Run QualityEvaluator → Verify QualityReport
 */

import { describe, test, expect } from "vitest"
import { loadDataset } from "../benchmark/dataset.js"
import { GoldenExecutor, type GoldenCase } from "../benchmark/executor/golden.js"
import { DefaultMemoryComparator, type ComparableMemory } from "../src/evaluation/comparison.js"
import { generateBenchmarkReport } from "../benchmark/reporter.js"
import { DefaultMemoryQualityEvaluator, type QualityMemory } from "../src/evaluation/quality-score.js"
import { join } from "node:path"

const dataDir = join(process.cwd(), "benchmark", "data")

describe("v0.3.1 Integration — Golden benchmark end-to-end", () => {
  test("load golden dataset → run executor → generate report with intelligence_score", async () => {
    // 1. Load golden cases
    const allCases = await loadDataset(dataDir)
    const goldenCases = allCases.filter((c) => c.id.startsWith("golden-")) as GoldenCase[]
    expect(goldenCases.length).toBe(50)

    // 2. Create mock runtime (returns expected as actual → baseline 100)
    const expectedLookup = new Map<string, unknown>()
    for (const c of goldenCases) {
      expectedLookup.set(JSON.stringify(c.input), c.expected)
    }
    const runtime = async (input: unknown) => expectedLookup.get(JSON.stringify(input)) ?? input

    // 3. Run golden executor
    const executor = new GoldenExecutor(runtime, new DefaultMemoryComparator(0.8))
    const results = await executor.execute(goldenCases)
    expect(results.length).toBe(50)
    expect(results.every((r) => r.passed)).toBe(true)

    // 4. Generate report
    const report = generateBenchmarkReport(results, "golden")
    expect(report.intelligence_score).toBe(100)
    expect(report.version).toBe("0.3.1")
    expect(Object.keys(report.suites).length).toBe(5)
  })

  test("golden benchmark with suite filter — only extraction cases", async () => {
    const allCases = await loadDataset(dataDir)
    const goldenExtraction = allCases.filter(
      (c) => c.id.startsWith("golden-") && c.suite === "extraction_pipeline",
    ) as GoldenCase[]
    expect(goldenExtraction.length).toBe(15)

    const expectedLookup = new Map<string, unknown>()
    for (const c of goldenExtraction) {
      expectedLookup.set(JSON.stringify(c.input), c.expected)
    }
    const runtime = async (input: unknown) => expectedLookup.get(JSON.stringify(input)) ?? input
    const executor = new GoldenExecutor(runtime, new DefaultMemoryComparator(0.8))
    const results = await executor.execute(goldenExtraction)

    const report = generateBenchmarkReport(results, "golden")
    expect(report.intelligence_score).toBe(100)
    expect(Object.keys(report.suites)).toEqual(["extraction_pipeline"])
  })

  test("quality evaluator on mock memory store", () => {
    const memories: QualityMemory[] = [
      {
        filename: "user_role.md",
        content: "User is a senior Go engineer.",
        name: "User Role",
        description: "Senior Go engineer",
        type: "user",
        scope: "user",
        confidence: "explicit",
        recallCount: 10,
        lastRecalledAt: new Date().toISOString(),
        mtimeMs: Date.now(),
      },
      {
        filename: "garbage.md",
        content: "TODO: fill this in",
        name: "Explicit Feedback",
        description: null,
        type: undefined,
        scope: undefined,
        confidence: undefined,
        recallCount: 0,
        lastRecalledAt: null,
        mtimeMs: Date.now() - 200 * 24 * 60 * 60 * 1000,
      },
    ]

    const evaluator = new DefaultMemoryQualityEvaluator()
    const report = evaluator.evaluate(memories)

    // One clean + one garbage → overall < 70
    expect(report.overall).toBeLessThan(70)
    // Completeness should be 50 (one complete, one not)
    expect(report.dimensions.completeness).toBe(50)
    // Noise should be 50 (one clean, one noisy)
    expect(report.dimensions.noise).toBe(50)
  })

  test("quality evaluator on empty store → overall = 100", () => {
    const evaluator = new DefaultMemoryQualityEvaluator()
    const report = evaluator.evaluate([])
    expect(report.overall).toBe(100)
    expect(report.dimensions.completeness).toBe(100)
  })

  test("golden executor with adversarial runtime — low scores", async () => {
    const allCases = await loadDataset(dataDir)
    const goldenCases = allCases.filter(
      (c) => c.id.startsWith("golden-") && c.suite === "dedup",
    ) as GoldenCase[]

    // Adversarial runtime: returns empty string (completely different from expected)
    const runtime = async () => ""
    const executor = new GoldenExecutor(runtime, new DefaultMemoryComparator(0.8))
    const results = await executor.execute(goldenCases)

    // All should fail (actual "" vs expected structured data)
    expect(results.every((r) => !r.passed)).toBe(true)
    expect(results.every((r) => r.score === 0)).toBe(true)
  })

  test("full flow — golden benchmark report contains suite scores matching individual suite results", async () => {
    const allCases = await loadDataset(dataDir)
    const goldenCases = allCases.filter(
      (c) => c.id.startsWith("golden-") && c.suite === "recall",
    ) as GoldenCase[]

    const expectedLookup = new Map<string, unknown>()
    for (const c of goldenCases) {
      expectedLookup.set(JSON.stringify(c.input), c.expected)
    }
    const runtime = async (input: unknown) => expectedLookup.get(JSON.stringify(input)) ?? input
    const executor = new GoldenExecutor(runtime, new DefaultMemoryComparator(0.8))
    const results = await executor.execute(goldenCases)

    const report = generateBenchmarkReport(results, "golden")
    // Check suite score matches average of case scores
    const avgScore = results.reduce((sum, r) => sum + r.score, 0) / results.length
    expect(report.suites.recall.score).toBe(Math.round(avgScore * 100))
  })

  test("comparison engine detects semantic similarity in golden cases", async () => {
    const comparator = new DefaultMemoryComparator()
    // These two texts share semantic meaning but differ in wording
    const result = await comparator.compareText(
      "User is a senior Go engineer",
      "User is a senior Go developer",
    )
    // Should detect some similarity (shared words: user, senior, go)
    expect(result.score).toBeGreaterThan(0.3)
  })
})
