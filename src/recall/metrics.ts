/**
 * opencode-memory — RecallQualityMetrics (v0.4.3)
 *
 * Computes recall quality metrics from RecallEvent and UserFeedback data.
 * Produces RetrievalAdjustment that modifies recall ranking, not memory truth.
 *
 * See: docs/superpowers/specs/v0.4.3/02-quality-metrics.md
 */

import type { RecallEvent, UserFeedback, FeedbackSource } from "./feedback.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RecallQualityMetrics {
  totalRecalls: number
  precisionAt1: number
  precisionAt3: number
  hitRate: number
  positiveRatio: number
  perMemory: Array<{
    filename: string
    recallCount: number
    avgRank: number
    positiveCount: number
    negativeCount: number
    usefulness: number
  }>
}

export interface RetrievalAdjustment {
  filename: string
  scoreModifier: number   // -0.2 to +0.2
  source: FeedbackSource
  reason: string
  expiresAt?: number
}

// ---------------------------------------------------------------------------
// Quality Metrics
// ---------------------------------------------------------------------------

export function computeRecallMetrics(
  events: RecallEvent[],
  feedbacks: UserFeedback[],
): RecallQualityMetrics {
  const totalRecalls = events.length

  // Positive ratio is computed from feedbacks regardless of events
  const positiveCount = feedbacks.filter((f) => f.feedback === "positive").length
  const positiveRatio = feedbacks.length > 0 ? positiveCount / feedbacks.length : 0

  if (totalRecalls === 0) {
    return {
      totalRecalls: 0,
      precisionAt1: 0,
      precisionAt3: 0,
      hitRate: 0,
      positiveRatio: round2(positiveRatio),
      perMemory: [],
    }
  }

  // Precision@K
  const withSelected = events.filter((e) => e.selected !== undefined)
  const precisionAt1 = withSelected.length > 0
    ? withSelected.filter((e) => e.results[0]?.filename === e.selected).length / withSelected.length
    : 0
  const precisionAt3 = withSelected.length > 0
    ? withSelected.filter((e) => {
        const top3 = new Set(e.results.slice(0, 3).map((r) => r.filename))
        return top3.has(e.selected!)
      }).length / withSelected.length
    : 0

  // Hit rate
  const hitRate = withSelected.length / totalRecalls

  // Positive ratio (already computed above for early return)
  // (no-op, positiveCount and positiveRatio are already defined)

  // Per-memory statistics
  const perMemory = computePerMemoryStats(events, feedbacks)

  return {
    totalRecalls,
    precisionAt1: round2(precisionAt1),
    precisionAt3: round2(precisionAt3),
    hitRate: round2(hitRate),
    positiveRatio: round2(positiveRatio),
    perMemory,
  }
}

function computePerMemoryStats(
  events: RecallEvent[],
  feedbacks: UserFeedback[],
): RecallQualityMetrics["perMemory"] {
  const memoryMap = new Map<string, {
    totalRecallCount: number
    rankSum: number
    positiveCount: number
    negativeCount: number
  }>()

  // Count recalls per memory
  for (const event of events) {
    for (const result of event.results) {
      const stats = memoryMap.get(result.filename) ?? {
        totalRecallCount: 0,
        rankSum: 0,
        positiveCount: 0,
        negativeCount: 0,
      }
      stats.totalRecallCount++
      stats.rankSum += result.rank
      memoryMap.set(result.filename, stats)
    }
  }

  // Count feedbacks per memory
  for (const fb of feedbacks) {
    const stats = memoryMap.get(fb.filename)
    if (stats) {
      if (fb.feedback === "positive") stats.positiveCount++
      if (fb.feedback === "negative") stats.negativeCount++
    }
  }

  return Array.from(memoryMap.entries()).map(([filename, stats]) => ({
    filename,
    recallCount: stats.totalRecallCount,
    avgRank: round2(stats.rankSum / stats.totalRecallCount),
    positiveCount: stats.positiveCount,
    negativeCount: stats.negativeCount,
    usefulness: computeUsefulness(stats),
  }))
}

function computeUsefulness(stats: {
  positiveCount: number
  negativeCount: number
  totalRecallCount: number
}): number {
  const totalFeedback = stats.positiveCount + stats.negativeCount
  if (totalFeedback === 0) return 0.5 // neutral
  if (stats.negativeCount === 0) return 1.0
  return stats.positiveCount / totalFeedback
}

// ---------------------------------------------------------------------------
// RetrievalAdjustment
// ---------------------------------------------------------------------------

export function computeRetrievalAdjustment(
  metrics: RecallQualityMetrics,
  filename: string,
  source: FeedbackSource = "system",
): RetrievalAdjustment {
  const memory = metrics.perMemory.find((m) => m.filename === filename)
  if (!memory) {
    return { filename, scoreModifier: 0, source, reason: "no feedback data" }
  }
  if (memory.recallCount < 3) {
    return { filename, scoreModifier: 0, source, reason: "insufficient data" }
  }

  if (memory.usefulness >= 0.8) {
    return { filename, scoreModifier: 0.1, source, reason: "consistently useful" }
  }
  if (memory.usefulness <= 0.2) {
    return { filename, scoreModifier: -0.1, source, reason: "consistently negative feedback" }
  }

  return { filename, scoreModifier: 0, source, reason: "neutral" }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100
}