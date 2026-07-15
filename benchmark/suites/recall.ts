/**
 * opencode-memory — Recall Benchmark Suite
 *
 * Tests the recall scoring pipeline: given a memory snapshot + query,
 * verify that scoreMemory() correctly ranks the expected memories on top.
 */

import { scoreMemory } from "../../src/evaluation/scoring.js"
import type { BenchmarkCase } from "../runner.js"
import type { MemoryHeader } from "../../src/config.js"

export interface RecallInput {
  query: string
  memories: Array<{
    filename: string
    header: {
      description?: string
      type?: string
      confidence?: string
    }
  }>
}

export interface RecallExpected {
  expected_files: string[]
}

/**
 * Execute a recall case: score all memories and return top-K filenames.
 */
export async function executeRecallCase(case_: BenchmarkCase): Promise<string[]> {
  const input = case_.input as RecallInput
  const query = input.query

  const headers: MemoryHeader[] = input.memories.map((m) => ({
    filename: m.filename,
    filePath: m.filename,
    mtimeMs: Date.now(),
    description: m.header.description ?? null,
    type: m.header.type as MemoryHeader["type"],
    scope: undefined,
    confidence: (m.header.confidence ?? "uncertain") as MemoryHeader["confidence"],
    schemaVersion: 1,
    recallCount: 0,
    lastRecalledAt: null,
  }))

  const scored = headers
    .map((h) => ({ filename: h.filename, score: scoreMemory(query, h) }))
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((h) => h.filename)

  return scored
}
