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
  benchmarks: Array<{
    name: string
    accuracy: number
    cases: number
    metrics?: Record<string, number>
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

  const benchmarks = [...suiteMap.entries()].map(([name, suiteResults]) => {
    const suitePassed = suiteResults.filter((r) => r.passed).length
    const accuracy = suiteResults.length > 0 ? suitePassed / suiteResults.length : 0
    return {
      name,
      accuracy: Math.round(accuracy * 100) / 100,
      cases: suiteResults.length,
    }
  })

  return {
    version: "0.3.0",
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
  }
}

export function formatBenchmarkJSON(report: BenchmarkReport): string {
  return JSON.stringify(report, null, 2)
}

export function formatBenchmarkConsole(report: BenchmarkReport): string {
  const lines: string[] = []
  lines.push("=== Benchmark Report ===")
  lines.push(`Mode: ${report.mode}  |  Score: ${report.summary.score}/100  |  Cases: ${report.summary.total_cases} (${report.summary.passed} pass, ${report.summary.failed} fail)`)
  lines.push("")

  for (const b of report.benchmarks) {
    lines.push(`  ${b.name}: accuracy=${b.accuracy} cases=${b.cases}`)
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
  lines.push(`| Total cases | ${report.summary.total_cases} |`)
  lines.push(`| Passed | ${report.summary.passed} |`)
  lines.push(`| Failed | ${report.summary.failed} |`)
  lines.push("")
  lines.push("## Benchmarks")
  lines.push("")
  lines.push(`| Suite | Accuracy | Cases |`)
  lines.push(`|-------|----------|-------|`)
  for (const b of report.benchmarks) {
    lines.push(`| ${b.name} | ${b.accuracy} | ${b.cases} |`)
  }

  return lines.join("\n")
}
