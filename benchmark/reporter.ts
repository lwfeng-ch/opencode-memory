/**
 * opencode-memory — Benchmark Reporter
 *
 * Generates benchmark report from results, writes to file, formats output.
 */

import type { BenchmarkResult, BenchmarkMode } from "./runner.js"

export interface BenchmarkReport {
  version: string
  timestamp: string
  mode: BenchmarkMode
  environment: {
    node: string
    platform: string
    model: string
  }
  summary: {
    score: number
    total_cases: number
    passed: number
    failed: number
  }
  /** @deprecated v0.3.1 — use `suites` instead. Kept for backward compat. */
  benchmarks: Array<{
    name: string
    accuracy: number
    cases: number
    metrics?: Record<string, number>
  }>
  /** v0.3.1: Memory Intelligence Score (weighted avg of suite scores) */
  intelligence_score: number
  /** v0.3.1: Per-suite score breakdown (replaces benchmarks) */
  suites: Record<string, {
    score: number
    cases: number
    passed: number
  }>
}

export function generateBenchmarkReport(
  results: BenchmarkResult[],
  mode: BenchmarkMode,
): BenchmarkReport {
  const total = results.length
  const passed = results.filter((r) => r.passed).length
  const failed = total - passed
  const avgScore = total > 0 ? results.reduce((sum, r) => sum + r.score, 0) / total : 0

  // Group by suite
  const suiteMap = new Map<string, BenchmarkResult[]>()
  for (const r of results) {
    if (!suiteMap.has(r.suite)) suiteMap.set(r.suite, [])
    suiteMap.get(r.suite)!.push(r)
  }

  // v0.3.1: Per-suite score breakdown (authoritative source)
  const suites: Record<string, { score: number; cases: number; passed: number }> = {}
  for (const [name, suiteResults] of suiteMap) {
    const suitePassed = suiteResults.filter((r) => r.passed).length
    const suiteAvg = suiteResults.length > 0
      ? suiteResults.reduce((sum, r) => sum + r.score, 0) / suiteResults.length
      : 0
    suites[name] = {
      score: Math.round(suiteAvg * 100),
      cases: suiteResults.length,
      passed: suitePassed,
    }
  }

  // v0.3.1: Intelligence Score = average of suite scores
  const suiteScores = Object.values(suites).map((s) => s.score)
  const intelligenceScore = suiteScores.length > 0
    ? Math.round(suiteScores.reduce((a, b) => a + b, 0) / suiteScores.length)
    : 0

  // Deprecated: benchmarks array derived from suites for backward compat
  const benchmarks = Object.entries(suites).map(([name, s]) => ({
    name,
    accuracy: s.cases > 0 ? Math.round((s.passed / s.cases) * 100) / 100 : 0,
    cases: s.cases,
  }))

  return {
    version: "0.3.1",
    timestamp: new Date().toISOString(),
    mode,
    environment: {
      node: process.version ?? "unknown",
      platform: process.platform ?? "unknown",
      model: mode,
    },
    summary: {
      score: Math.round(avgScore * 100),
      total_cases: total,
      passed,
      failed,
    },
    benchmarks,
    intelligence_score: intelligenceScore,
    suites,
  }
}

export function formatBenchmarkJSON(report: BenchmarkReport): string {
  return JSON.stringify(report, null, 2)
}

export function formatBenchmarkConsole(report: BenchmarkReport): string {
  const lines: string[] = []
  lines.push("=== Benchmark Report ===")
  lines.push(`Mode: ${report.mode}  |  Intelligence Score: ${report.intelligence_score}/100  |  Cases: ${report.summary.total_cases} (${report.summary.passed} pass, ${report.summary.failed} fail)`)
  lines.push("")

  for (const [name, suite] of Object.entries(report.suites)) {
    lines.push(`  ${name}: score=${suite.score} cases=${suite.cases} (${suite.passed} pass)`)
  }

  return lines.join("\n")
}

export function formatBenchmarkMarkdown(report: BenchmarkReport): string {
  const lines: string[] = []
  lines.push("# Benchmark Report")
  lines.push("")
  lines.push(`**Version**: ${report.version}`)
  lines.push(`**Mode**: ${report.mode}`)
  lines.push(`**Timestamp**: ${report.timestamp}`)
  lines.push("")
  lines.push("## Summary")
  lines.push("")
  lines.push(`| Metric | Value |`)
  lines.push(`|--------|-------|`)
  lines.push(`| Score | ${report.summary.score}/100 |`)
  lines.push(`| Intelligence Score | ${report.intelligence_score}/100 |`)
  lines.push(`| Total cases | ${report.summary.total_cases} |`)
  lines.push(`| Passed | ${report.summary.passed} |`)
  lines.push(`| Failed | ${report.summary.failed} |`)
  lines.push("")
  lines.push("## Suite Scores")
  lines.push("")
  lines.push(`| Suite | Score | Cases | Passed |`)
  lines.push(`|-------|-------|-------|--------|`)
  for (const [name, suite] of Object.entries(report.suites)) {
    lines.push(`| ${name} | ${suite.score} | ${suite.cases} | ${suite.passed} |`)
  }

  return lines.join("\n")
}
