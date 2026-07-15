/**
 * opencode-memory — Conflict Benchmark Suite
 *
 * Tests the promotion/canOverride pipeline: given conflicting memories,
 * verify that the correct one is kept active based on confidence levels.
 */

import { canOverride } from "../../src/promotion.js"
import type { BenchmarkCase } from "../runner.js"

export interface ConflictInput {
  memories: Array<{
    filename: string
    confidence: string
    content: string
  }>
}

/**
 * Execute a conflict case: determine which memory should remain active.
 * Uses canOverride to check if the second can override the first.
 * Returns the filename of the memory that should be kept.
 */
export async function executeConflictCase(case_: BenchmarkCase): Promise<string> {
  const input = case_.input as ConflictInput
  const memories = input.memories
  if (memories.length < 2) return memories[0]?.filename ?? ""

  // For each pair, check if the new memory can override the active one
  // canOverride signature: (oldConfidence, newConfidence) → newPriority > oldPriority
  let activeIdx = 0
  for (let i = 1; i < memories.length; i++) {
    if (canOverride(memories[activeIdx].confidence, memories[i].confidence)) {
      activeIdx = i
    }
  }
  return memories[activeIdx].filename
}
