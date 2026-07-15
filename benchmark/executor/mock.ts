/**
 * opencode-memory — Mock Benchmark Executor
 *
 * Two modes:
 *   strict: calls suite-specific logic → tests pipeline (validator, dedup, recall)
 *   adversarial: returns faulty output → tests defensive capabilities
 */

import type { BenchmarkExecutor, BenchmarkCase } from "../runner.js"
import { executeDedupCase } from "../suites/dedup.js"
import { executeRecallCase } from "../suites/recall.js"
import { executeConflictCase } from "../suites/conflict.js"
import { executeExtractionCase } from "../suites/extraction_pipeline.js"
import { executeForgettingCase } from "../suites/forgetting.js"

export type MockMode = "strict" | "adversarial"

export function createStrictExecutor(): BenchmarkExecutor {
  return {
    async execute(case_: BenchmarkCase): Promise<unknown> {
      // Dispatch to suite-specific executor
      switch (case_.suite) {
        case "dedup":
          return executeDedupCase(case_)
        case "recall":
          return executeRecallCase(case_)
        case "conflict":
          return executeConflictCase(case_)
        case "extraction_pipeline":
          return executeExtractionCase(case_)
        case "forgetting":
          return executeForgettingCase(case_)
        default:
          return case_.expected
      }
    },
  }
}

export function createAdversarialExecutor(): BenchmarkExecutor {
  const faultTypes = ["empty", "truncated", "garbage", "missing_fields", "oversized"]
  let faultIndex = 0

  return {
    async execute(case_: BenchmarkCase): Promise<unknown> {
      const fault = faultTypes[faultIndex % faultTypes.length]
      faultIndex++
      return generateFaultyOutput(case_, fault)
    },
  }
}

export function createMockExecutor(mode: MockMode = "strict"): BenchmarkExecutor {
  return mode === "adversarial" ? createAdversarialExecutor() : createStrictExecutor()
}

function generateFaultyOutput(case_: BenchmarkCase, fault: string): unknown {
  const expectedStr = typeof case_.expected === "string"
    ? case_.expected
    : JSON.stringify(case_.expected)

  switch (fault) {
    case "empty":
      return ""
    case "truncated":
      return expectedStr.slice(0, 10) + "..."
    case "garbage":
      return "random garbage text that should be rejected"
    case "missing_fields":
      return {}
    case "oversized":
      return "x".repeat(10000)
    default:
      return case_.expected
  }
}
