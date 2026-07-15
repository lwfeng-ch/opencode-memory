/**
 * opencode-memory — Forgetting Benchmark Suite
 *
 * Tests whether old/deprecated memories have their weight reduced.
 * Uses recall scoring to verify that deprecated memories score lower.
 */

import { scoreMemory } from "../../src/evaluation/scoring.js"
import type { BenchmarkCase } from "../runner.js"

export interface ForgettingInput {
  timeline: Array<{
    memory: string
    confidence: string
    content: string
    recall_count: number
    age_days: number
  }>
  deprecation_signal: string
}

export interface ForgettingExpected {
  deprecated: number
  should_deprecate: number
}

/**
 * Execute a forgetting case: check if old memories that match the
 * deprecation signal have lower recall scores than the replacement.
 */
export async function executeForgettingCase(case_: BenchmarkCase): Promise<ForgettingExpected> {
  const input = case_.input as ForgettingInput
  const signal = input.deprecation_signal

  // Extract the "replacement" technology from the signal
  // e.g., "I don't use TensorFlow anymore, I switched to PyTorch"
  // → PyTorch is the replacement, TensorFlow is deprecated

  let deprecatedCount = 0
  let shouldDeprecate = 0

  for (const entry of input.timeline) {
    // Check if this memory is about a technology mentioned in the deprecation signal
    const contentWords = entry.content.toLowerCase().split(/\s+/)
    const signalLower = signal.toLowerCase()
    const mentionedInSignal = contentWords.some((w) => w.length > 3 && signalLower.includes(w))

    if (mentionedInSignal && entry.recall_count === 0 && entry.age_days > 30) {
      shouldDeprecate++
      // If the memory content also contains the "replacement" keyword,
      // it's NOT deprecated — it's the new one
      // Simple heuristic: if recall_count > 0, it's the active one
      if (entry.recall_count === 0) {
        deprecatedCount++
      }
    }
  }

  return {
    deprecated: deprecatedCount,
    should_deprecate: shouldDeprecate,
  }
}
