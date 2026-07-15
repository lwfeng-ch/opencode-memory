/**
 * opencode-memory — Dedup Benchmark Suite
 *
 * Tests the fingerprint dedup pipeline: given a set of memory contents,
 * verify that shouldMerge() correctly identifies duplicates.
 */

import { shouldMerge, computeFingerprint, jaccardSimilarity } from "../../src/evaluation/fingerprint.js"
import type { BenchmarkCase, BenchmarkExecutor, BenchmarkResult } from "../runner.js"

export interface DedupInput {
  memories: string[]
}

export interface DedupExpected {
  merged_count: number
  remaining: string[]
}

/**
 * Execute a dedup case: count how many pairs would be merged.
 */
export async function executeDedupCase(case_: BenchmarkCase): Promise<DedupExpected> {
  const input = case_.input as DedupInput
  const memories = input.memories

  const merged = new Set<number>()
  let mergedCount = 0

  for (let i = 0; i < memories.length; i++) {
    if (merged.has(i)) continue
    for (let j = i + 1; j < memories.length; j++) {
      if (merged.has(j)) continue
      if (shouldMerge(memories[i], memories[j])) {
        merged.add(j)
        mergedCount++
      }
    }
  }

  const remaining = memories.filter((_, idx) => !merged.has(idx))
  return { merged_count: mergedCount, remaining }
}
