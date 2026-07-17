/**
 * opencode-memory — Benchmark Report Schema (v0.3.2)
 *
 * Unified report schema that carries full reproducibility metadata:
 * model info, comparator weights, cost tracking, and case-level results.
 *
 * Import weight constants from DefaultMemoryComparator to keep report
 * weights aligned with actual comparison logic.
 */

import type { BenchmarkResult } from "./runner.js"
import { DefaultMemoryComparator } from "../src/evaluation/comparison.js"

// ---------------------------------------------------------------------------
// BenchmarkReport (v0.3.2)
// ---------------------------------------------------------------------------

export interface BenchmarkReport {
  /** Schema version, e.g. "0.3.2" */
  version: string
  /** ISO-8601 timestamp of report generation */
  timestamp: string

  /** Overall Memory Intelligence Score (0-100) */
  intelligenceScore: number
  /** Per-suite breakdown with optional stats */
  suiteScores: Record<string, {
    score: number
    stddev?: number
    ci95?: [number, number]
    cases: number
    passed: number
  }>

  /** Model used for the benchmark run */
  model: {
    name: string
    provider: string
    temperature: number
  }

  /** Comparator metadata for reproducibility */
  comparator: {
    mode: "hybrid-4layer" | "legacy-3layer"
    embeddingAvailable: boolean
    embeddingModel?: string
    embeddingDimensions?: number
    weights: {
      lexical: { tokenJaccard: number; tfidf: number; bigram: number }
      embedding: number
      fields: { content: number; description: number; type: number; name: number }
    }
  }

  /** Cost and performance tracking */
  cost: {
    llmCalls: number
    cacheHits: number
    tokens: { input: number; output: number }
    avgLatencyMs: number
    totalDurationMs: number
  }

  /** Case-level results (raw BenchmarkResult items) */
  results: BenchmarkResult[]
}

// ---------------------------------------------------------------------------
// generateReport — factory
// ---------------------------------------------------------------------------

export interface GenerateReportParams {
  results: BenchmarkResult[]
  modelName: string
  modelProvider: string
  temperature: number
  comparatorMode: "hybrid-4layer" | "legacy-3layer"
  embeddingAvailable: boolean
  embeddingModel?: string
  embeddingDimensions?: number
  llmCalls: number
  cacheHits: number
  inputTokens: number
  outputTokens: number
  totalDurationMs: number
}

/**
 * Assemble a BenchmarkReport from run results + metadata.
 * Computes intelligenceScore as the weighted average of suite scores.
 */
export function generateReport(params: GenerateReportParams): BenchmarkReport {
  const { results, modelName, modelProvider, temperature, comparatorMode, embeddingAvailable, embeddingModel, embeddingDimensions, llmCalls, cacheHits, inputTokens, outputTokens, totalDurationMs } = params

  // Group by suite
  const suiteMap = new Map<string, BenchmarkResult[]>()
  for (const r of results) {
    if (!suiteMap.has(r.suite)) suiteMap.set(r.suite, [])
    suiteMap.get(r.suite)!.push(r)
  }

  // Compute per-suite scores
  const suiteScores: BenchmarkReport["suiteScores"] = {}
  for (const [suite, suiteResults] of suiteMap) {
    const passed = suiteResults.filter((r) => r.passed).length
    const avgScore = suiteResults.length > 0
      ? suiteResults.reduce((sum, r) => sum + r.score, 0) / suiteResults.length
      : 0

    suiteScores[suite] = {
      score: Math.round(avgScore * 100),
      cases: suiteResults.length,
      passed,
    }
  }

  // Compute intelligence score (average of suite scores)
  const scores = Object.values(suiteScores).map((s) => s.score)
  const intelligenceScore = scores.length > 0
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : 0

  const avgLatencyMs = results.length > 0
    ? Math.round(results.reduce((sum, r) => sum + r.durationMs, 0) / results.length)
    : 0

  // Determine which mode's weights to report
  const isHybrid = comparatorMode === "hybrid-4layer"

  return {
    version: "0.3.2",
    timestamp: new Date().toISOString(),
    intelligenceScore,
    suiteScores,
    model: {
      name: modelName,
      provider: modelProvider,
      temperature,
    },
    comparator: {
      mode: comparatorMode,
      embeddingAvailable,
      embeddingModel,
      embeddingDimensions,
      weights: {
        lexical: {
          tokenJaccard: DefaultMemoryComparator.HYBRID_WEIGHTS.tokenJaccard,
          tfidf: DefaultMemoryComparator.HYBRID_WEIGHTS.tfidf,
          bigram: DefaultMemoryComparator.HYBRID_WEIGHTS.bigram,
        },
        embedding: DefaultMemoryComparator.HYBRID_WEIGHTS.embedding,
        fields: {
          content: DefaultMemoryComparator.FIELD_WEIGHTS.content,
          description: DefaultMemoryComparator.FIELD_WEIGHTS.description,
          type: DefaultMemoryComparator.FIELD_WEIGHTS.type,
          name: DefaultMemoryComparator.FIELD_WEIGHTS.name,
        },
      },
    },
    cost: {
      llmCalls,
      cacheHits,
      tokens: { input: inputTokens, output: outputTokens },
      avgLatencyMs,
      totalDurationMs,
    },
    results,
  }
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

/**
 * Format report as a CLI-friendly Markdown string.
 * Includes score, model info, comparator metadata, cost, and case breakdown.
 */
export function formatReportMarkdown(report: BenchmarkReport): string {
  const lines: string[] = []

  lines.push("# Benchmark Report")
  lines.push("")
  lines.push(`**Version**: ${report.version}`)
  lines.push(`**Timestamp**: ${report.timestamp}`)
  lines.push("")

  // Summary
  lines.push("## Summary")
  lines.push("")
  lines.push(`| Metric | Value |`)
  lines.push(`|--------|-------|`)
  lines.push(`| Intelligence Score | ${report.intelligenceScore}/100 |`)
  lines.push(`| Total Cases | ${report.results.length} |`)
  const totalPassed = report.results.filter((r) => r.passed).length
  const totalFailed = report.results.length - totalPassed
  lines.push(`| Passed | ${totalPassed} |`)
  lines.push(`| Failed | ${totalFailed} |`)
  lines.push("")

  // Model
  lines.push("## Model")
  lines.push("")
  lines.push(`| Field | Value |`)
  lines.push(`|-------|-------|`)
  lines.push(`| Name | ${report.model.name} |`)
  lines.push(`| Provider | ${report.model.provider} |`)
  lines.push(`| Temperature | ${report.model.temperature} |`)
  lines.push("")

  // Comparator
  lines.push("## Comparator")
  lines.push("")
  lines.push(`| Field | Value |`)
  lines.push(`|-------|-------|`)
  lines.push(`| Mode | ${report.comparator.mode} |`)
  lines.push(`| Embedding Available | ${report.comparator.embeddingAvailable} |`)
  if (report.comparator.embeddingModel) {
    lines.push(`| Embedding Model | ${report.comparator.embeddingModel} |`)
  }
  if (report.comparator.embeddingDimensions) {
    lines.push(`| Embedding Dimensions | ${report.comparator.embeddingDimensions} |`)
  }
  lines.push("")

  // Costs
  lines.push("## Cost")
  lines.push("")
  lines.push(`| Metric | Value |`)
  lines.push(`|--------|-------|`)
  lines.push(`| LLM Calls | ${report.cost.llmCalls} |`)
  lines.push(`| Cache Hits | ${report.cost.cacheHits} |`)
  lines.push(`| Input Tokens | ${report.cost.tokens.input} |`)
  lines.push(`| Output Tokens | ${report.cost.tokens.output} |`)
  lines.push(`| Avg Latency | ${report.cost.avgLatencyMs}ms |`)
  lines.push(`| Total Duration | ${report.cost.totalDurationMs}ms |`)
  lines.push("")

  // Suite scores
  lines.push("## Suite Scores")
  lines.push("")
  lines.push(`| Suite | Score | Cases | Passed |`)
  lines.push(`|-------|-------|-------|--------|`)
  for (const [suite, s] of Object.entries(report.suiteScores)) {
    const stddevStr = s.stddev !== undefined ? ` \\u00b1 ${s.stddev}` : ""
    lines.push(`| ${suite} | ${s.score}${stddevStr} | ${s.cases} | ${s.passed} |`)
  }
  lines.push("")

  // Case details
  lines.push("## Case Breakdown")
  lines.push("")
  lines.push(`| Case | Status | Score | Duration |`)
  lines.push(`|------|--------|-------|----------|`)
  for (const r of report.results) {
    const status = r.passed ? "\\u2705" : "\\u274c"
    lines.push(`| ${r.caseId} | ${status} | ${(r.score * 100).toFixed(1)} | ${r.durationMs}ms |`)
  }

  return lines.join("\n")
}

/**
 * Format report as JSON with 2-space indentation.
 */
export function formatReportJSON(report: BenchmarkReport): string {
  return JSON.stringify(report, null, 2)
}
