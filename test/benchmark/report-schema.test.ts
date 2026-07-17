/**
 * opencode-memory — Benchmark Report Schema Tests (v0.3.2)
 */

import { describe, test, expect } from "vitest"
import { generateReport, formatReportMarkdown, formatReportJSON } from "../../benchmark/report-schema.js"
import type { BenchmarkResult } from "../../benchmark/runner.js"

function makeResult(overrides: Partial<BenchmarkResult> & { caseId: string; suite: "extraction_pipeline" | "recall" | "dedup" | "forgetting" | "conflict" }): BenchmarkResult {
  return {
    caseId: overrides.caseId,
    suite: overrides.suite,
    passed: overrides.passed ?? true,
    actual: overrides.actual ?? { content: "actual" },
    expected: overrides.expected ?? { content: "expected" },
    score: overrides.score ?? 1.0,
    durationMs: overrides.durationMs ?? 100,
    error: overrides.error,
  }
}

describe("generateReport", () => {
  test("produces complete report structure", () => {
    const results: BenchmarkResult[] = [
      makeResult({ caseId: "ext-001", suite: "extraction_pipeline", score: 0.9, passed: true, durationMs: 150 }),
      makeResult({ caseId: "ext-002", suite: "extraction_pipeline", score: 0.5, passed: false, durationMs: 200, error: "mismatch" }),
      makeResult({ caseId: "rec-001", suite: "recall", score: 0.85, passed: true, durationMs: 80 }),
    ]

    const report = generateReport({
      results,
      modelName: "qwen3-14b",
      modelProvider: "qwen",
      temperature: 0,
      comparatorMode: "hybrid-4layer",
      embeddingAvailable: true,
      embeddingModel: "bge-m3",
      embeddingDimensions: 1024,
      llmCalls: 45,
      cacheHits: 30,
      inputTokens: 87300,
      outputTokens: 22500,
      totalDurationMs: 5000,
    })

    // Version
    expect(report.version).toBe("0.3.2")
    expect(report.timestamp).toBeTruthy()
    expect(() => new Date(report.timestamp)).not.toThrow()

    // Intelligence score
    expect(typeof report.intelligenceScore).toBe("number")

    // Suite scores
    expect(report.suiteScores.extraction_pipeline).toBeDefined()
    expect(report.suiteScores.recall).toBeDefined()
    expect(report.suiteScores.extraction_pipeline.cases).toBe(2)
    expect(report.suiteScores.extraction_pipeline.passed).toBe(1)
    expect(report.suiteScores.recall.cases).toBe(1)
    expect(report.suiteScores.recall.passed).toBe(1)

    // Model
    expect(report.model.name).toBe("qwen3-14b")
    expect(report.model.provider).toBe("qwen")
    expect(report.model.temperature).toBe(0)

    // Comparator
    expect(report.comparator.mode).toBe("hybrid-4layer")
    expect(report.comparator.embeddingAvailable).toBe(true)
    expect(report.comparator.embeddingModel).toBe("bge-m3")
    expect(report.comparator.embeddingDimensions).toBe(1024)
    expect(report.comparator.weights.lexical.tokenJaccard).toBe(0.15)
    expect(report.comparator.weights.lexical.tfidf).toBe(0.35)
    expect(report.comparator.weights.lexical.bigram).toBe(0.15)
    expect(report.comparator.weights.embedding).toBe(0.35)
    expect(report.comparator.weights.fields.content).toBe(0.50)
    expect(report.comparator.weights.fields.description).toBe(0.20)
    expect(report.comparator.weights.fields.type).toBe(0.20)
    expect(report.comparator.weights.fields.name).toBe(0.10)

    // Cost
    expect(report.cost.llmCalls).toBe(45)
    expect(report.cost.cacheHits).toBe(30)
    expect(report.cost.tokens.input).toBe(87300)
    expect(report.cost.tokens.output).toBe(22500)
    expect(report.cost.totalDurationMs).toBe(5000)

    // Results preserved
    expect(report.results).toHaveLength(3)
  })

  test("computes intelligenceScore correctly", () => {
    const results: BenchmarkResult[] = [
      makeResult({ caseId: "a", suite: "extraction_pipeline", score: 1.0, passed: true }),
      makeResult({ caseId: "b", suite: "recall", score: 0.5, passed: false }),
    ]

    const report = generateReport({
      results,
      modelName: "test",
      modelProvider: "test",
      temperature: 0,
      comparatorMode: "legacy-3layer",
      embeddingAvailable: false,
      llmCalls: 0,
      cacheHits: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalDurationMs: 0,
    })

    // extraction_pipeline: avg=(1.0) → 100
    // recall: avg=(0.5) → 50
    // intelligence = (100+50)/2 = 75
    expect(report.intelligenceScore).toBe(75)
  })

  test("handles empty results", () => {
    const report = generateReport({
      results: [],
      modelName: "test",
      modelProvider: "test",
      temperature: 0,
      comparatorMode: "legacy-3layer",
      embeddingAvailable: false,
      llmCalls: 0,
      cacheHits: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalDurationMs: 0,
    })

    expect(report.intelligenceScore).toBe(0)
    expect(report.suiteScores).toEqual({})
    expect(report.cost.avgLatencyMs).toBe(0)
  })

  test("legacy-3layer mode sets comparator values", () => {
    const results = [makeResult({ caseId: "a", suite: "extraction_pipeline", score: 0.8 })]
    const report = generateReport({
      results,
      modelName: "test",
      modelProvider: "test",
      temperature: 0,
      comparatorMode: "legacy-3layer",
      embeddingAvailable: false,
      llmCalls: 0,
      cacheHits: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalDurationMs: 0,
    })

    expect(report.comparator.mode).toBe("legacy-3layer")
    expect(report.comparator.embeddingAvailable).toBe(false)
    expect(report.comparator.embeddingModel).toBeUndefined()
    expect(report.comparator.embeddingDimensions).toBeUndefined()
  })
})

describe("formatReportMarkdown", () => {
  test("contains key sections", () => {
    const results = [makeResult({ caseId: "ext-001", suite: "extraction_pipeline", score: 0.9, passed: true })]
    const report = generateReport({
      results,
      modelName: "gpt-4o",
      modelProvider: "openai",
      temperature: 0.5,
      comparatorMode: "hybrid-4layer",
      embeddingAvailable: true,
      embeddingModel: "text-embedding-3-small",
      embeddingDimensions: 1536,
      llmCalls: 10,
      cacheHits: 5,
      inputTokens: 1000,
      outputTokens: 500,
      totalDurationMs: 2000,
    })

    const md = formatReportMarkdown(report)

    expect(md).toContain("# Benchmark Report")
    expect(md).toContain("Intelligence Score")
    expect(md).toContain("gpt-4o")
    expect(md).toContain("openai")
    expect(md).toContain("hybrid-4layer")
    expect(md).toContain("extraction_pipeline")
    expect(md).toContain("ext-001")
    expect(md).toContain("LLM Calls")
    expect(md).toContain("Cache Hits")
    expect(md).toContain("Suite Scores")
    expect(md).toContain("Case Breakdown")
  })
})

describe("formatReportJSON", () => {
  test("produces valid JSON", () => {
    const results = [makeResult({ caseId: "t-001", suite: "dedup", score: 1.0, passed: true })]
    const report = generateReport({
      results,
      modelName: "test",
      modelProvider: "test",
      temperature: 0,
      comparatorMode: "legacy-3layer",
      embeddingAvailable: false,
      llmCalls: 0,
      cacheHits: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalDurationMs: 0,
    })

    const json = formatReportJSON(report)
    const parsed = JSON.parse(json)

    expect(parsed.version).toBe("0.3.2")
    expect(parsed.intelligenceScore).toBeTypeOf("number")
    expect(parsed.model).toBeDefined()
    expect(parsed.comparator).toBeDefined()
    expect(parsed.cost).toBeDefined()
    expect(parsed.results).toBeInstanceOf(Array)
    expect(parsed.suiteScores).toBeDefined()
  })
})
