/**
 * opencode-memory — Reporter Upgrade Tests (v0.3.1)
 *
 * Tests the upgraded BenchmarkReport with intelligence_score and suites.
 */

import { describe, test, expect } from "vitest"
import {
  generateBenchmarkReport,
  formatBenchmarkJSON,
  formatBenchmarkConsole,
  formatBenchmarkMarkdown,
  type BenchmarkReport,
} from "../../benchmark/reporter.js"
import type { BenchmarkResult } from "../../benchmark/runner.js"

function makeResult(overrides: Partial<BenchmarkResult> = {}): BenchmarkResult {
  return {
    caseId: "test-001",
    suite: "dedup",
    passed: true,
    actual: {},
    expected: {},
    score: 1.0,
    durationMs: 10,
    ...overrides,
  }
}

describe("Reporter v0.3.1 — intelligence_score and suites", () => {
  test("report has intelligence_score field", () => {
    const report = generateBenchmarkReport([makeResult()], "mock")
    expect(report).toHaveProperty("intelligence_score")
    expect(typeof report.intelligence_score).toBe("number")
  })

  test("report has suites field with per-suite breakdown", () => {
    const report = generateBenchmarkReport([makeResult()], "mock")
    expect(report).toHaveProperty("suites")
    expect(report.suites).toHaveProperty("dedup")
    expect(report.suites.dedup).toHaveProperty("score")
    expect(report.suites.dedup).toHaveProperty("cases")
    expect(report.suites.dedup).toHaveProperty("passed")
  })

  test("report version is 0.3.1", () => {
    const report = generateBenchmarkReport([makeResult()], "mock")
    expect(report.version).toBe("0.3.1")
  })

  test("intelligence_score is average of suite scores", () => {
    const results = [
      makeResult({ caseId: "a", suite: "dedup", score: 1.0 }),
      makeResult({ caseId: "b", suite: "dedup", score: 0.8 }),
      makeResult({ caseId: "c", suite: "recall", score: 0.6 }),
      makeResult({ caseId: "d", suite: "recall", score: 0.4 }),
    ]
    const report = generateBenchmarkReport(results, "mock")
    // dedup avg = 0.9 → 90, recall avg = 0.5 → 50
    // intelligence_score = (90 + 50) / 2 = 70
    expect(report.intelligence_score).toBe(70)
  })

  test("empty results → intelligence_score = 0", () => {
    const report = generateBenchmarkReport([], "mock")
    expect(report.intelligence_score).toBe(0)
  })

  test("console format includes intelligence score", () => {
    const report = generateBenchmarkReport([makeResult()], "mock")
    const output = formatBenchmarkConsole(report)
    expect(output).toContain("Intelligence Score")
    expect(output).toContain("100")
  })

  test("markdown format includes suite scores table", () => {
    const report = generateBenchmarkReport([makeResult()], "mock")
    const output = formatBenchmarkMarkdown(report)
    expect(output).toContain("Suite Scores")
    expect(output).toContain("dedup")
  })

  test("JSON format includes all v0.3.1 fields", () => {
    const report = generateBenchmarkReport([makeResult()], "mock")
    const json = formatBenchmarkJSON(report)
    const parsed = JSON.parse(json)
    expect(parsed).toHaveProperty("intelligence_score")
    expect(parsed).toHaveProperty("suites")
    expect(parsed.version).toBe("0.3.1")
  })

  test("single suite report has one suite entry", () => {
    const results = [makeResult({ suite: "conflict", score: 0.85 })]
    const report = generateBenchmarkReport(results, "mock")
    expect(Object.keys(report.suites)).toHaveLength(1)
    expect(report.suites.conflict.score).toBe(85)
  })

  test("multiple suites each get their own score entry", () => {
    const results = [
      makeResult({ caseId: "a", suite: "dedup", score: 1.0 }),
      makeResult({ caseId: "b", suite: "recall", score: 0.5 }),
      makeResult({ caseId: "c", suite: "conflict", score: 0.8 }),
    ]
    const report = generateBenchmarkReport(results, "mock")
    expect(Object.keys(report.suites).sort()).toEqual(["conflict", "dedup", "recall"])
    expect(report.suites.dedup.score).toBe(100)
    expect(report.suites.recall.score).toBe(50)
    expect(report.suites.conflict.score).toBe(80)
  })
})
