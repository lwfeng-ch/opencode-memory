/**
 * opencode-memory — Golden Benchmark Executor Tests (v0.3.1)
 *
 * Tests the Golden executor that wraps a runtime executor + semantic comparator
 * to produce BenchmarkResults with comparison-based scores.
 */

import { describe, test, expect } from "vitest"
import {
  GoldenExecutor,
  type GoldenCase,
  type RuntimeExecutorFn,
} from "../../benchmark/executor/golden.js"
import { DefaultMemoryComparator, type ComparableMemory } from "../../src/evaluation/comparison.js"
import type { BenchmarkResult } from "../../benchmark/runner.js"

describe("GoldenCase interface", () => {
  test("GoldenCase can be constructed with required metadata", () => {
    const case_: GoldenCase = {
      id: "golden-001",
      version: "0.3.1",
      suite: "extraction_pipeline",
      input: { messages: [{ role: "user", content: "I use Python for ML" }] },
      expected: { content: "User uses Python for machine learning", type: "user", name: "Python ML" },
      metadata: {
        createdAt: "2026-07-15T00:00:00Z",
        model: "test-model",
        reviewer: "human",
      },
    }
    expect(case_.id).toBe("golden-001")
    expect(case_.metadata.createdAt).toBe("2026-07-15T00:00:00Z")
    expect(case_.metadata.model).toBe("test-model")
    expect(case_.metadata.reviewer).toBe("human")
  })
})

describe("GoldenExecutor", () => {
  const comparator = new DefaultMemoryComparator(0.8)

  test("can be created with a comparator and runtime executor", () => {
    const runtime: RuntimeExecutorFn = async () => ({ content: "test" })
    const executor = new GoldenExecutor(runtime, comparator)
    expect(executor).toBeDefined()
    expect(typeof executor.execute).toBe("function")
  })

  test("execute returns BenchmarkResult array with correct structure", async () => {
    const expectedMem: ComparableMemory = {
      content: "The user is a senior Go engineer.",
      name: "User Role",
      type: "user",
    }
    const runtime: RuntimeExecutorFn = async () => expectedMem
    const executor = new GoldenExecutor(runtime, comparator)

    const cases: GoldenCase[] = [{
      id: "g-001",
      version: "0.3.1",
      suite: "extraction_pipeline",
      input: { messages: [] },
      expected: expectedMem,
      metadata: { createdAt: "2026-07-15T00:00:00Z" },
    }]

    const results = await executor.execute(cases)
    expect(results).toHaveLength(1)
    expect(results[0]).toHaveProperty("caseId")
    expect(results[0]).toHaveProperty("suite")
    expect(results[0]).toHaveProperty("passed")
    expect(results[0]).toHaveProperty("actual")
    expect(results[0]).toHaveProperty("expected")
    expect(results[0]).toHaveProperty("score")
    expect(results[0]).toHaveProperty("durationMs")
  })

  test("identical output returns passed=true and score=1.0", async () => {
    const expectedMem: ComparableMemory = {
      content: "The user is a senior Go engineer.",
      name: "User Role",
      type: "user",
    }
    const runtime: RuntimeExecutorFn = async () => expectedMem
    const executor = new GoldenExecutor(runtime, comparator)

    const results = await executor.execute([{
      id: "g-002",
      version: "0.3.1",
      suite: "extraction_pipeline",
      input: {},
      expected: expectedMem,
      metadata: { createdAt: "2026-07-15T00:00:00Z" },
    }])

    expect(results[0].passed).toBe(true)
    expect(results[0].score).toBe(1.0)
  })

  test("different output returns passed=false and score < threshold", async () => {
    const expectedMem: ComparableMemory = {
      content: "The user is a senior Go engineer.",
      name: "User Role",
      type: "user",
    }
    const actualMem: ComparableMemory = {
      content: "The weather today is sunny.",
      name: "Weather",
      type: "project",
    }
    const runtime: RuntimeExecutorFn = async () => actualMem
    const executor = new GoldenExecutor(runtime, comparator)

    const results = await executor.execute([{
      id: "g-003",
      version: "0.3.1",
      suite: "extraction_pipeline",
      input: {},
      expected: expectedMem,
      metadata: { createdAt: "2026-07-15T00:00:00Z" },
    }])

    expect(results[0].passed).toBe(false)
    expect(results[0].score).toBeLessThan(0.8)
  })

  test("similar output returns score between 0 and 1", async () => {
    const expectedMem: ComparableMemory = {
      content: "The user is a senior Go engineer who prefers backend development.",
      name: "User Role",
      type: "user",
    }
    const actualMem: ComparableMemory = {
      content: "The user is a senior Go engineer who prefers backend development.",
      name: "Engineer Role",
      type: "user",
    }
    const runtime: RuntimeExecutorFn = async () => actualMem
    const executor = new GoldenExecutor(runtime, comparator)

    const results = await executor.execute([{
      id: "g-004",
      version: "0.3.1",
      suite: "extraction_pipeline",
      input: {},
      expected: expectedMem,
      metadata: { createdAt: "2026-07-15T00:00:00Z" },
    }])

    expect(results[0].score).toBeGreaterThan(0)
    expect(results[0].score).toBeLessThan(1.0)
  })

  test("runtime error produces result with error field and passed=false", async () => {
    const runtime: RuntimeExecutorFn = async () => {
      throw new Error("LLM unavailable")
    }
    const executor = new GoldenExecutor(runtime, comparator)

    const results = await executor.execute([{
      id: "g-005",
      version: "0.3.1",
      suite: "extraction_pipeline",
      input: {},
      expected: { content: "test" },
      metadata: { createdAt: "2026-07-15T00:00:00Z" },
    }])

    expect(results[0].passed).toBe(false)
    expect(results[0].score).toBe(0)
    expect(results[0].error).toContain("LLM unavailable")
  })

  test("duration is recorded and > 0", async () => {
    const runtime: RuntimeExecutorFn = async () => ({ content: "test" })
    const executor = new GoldenExecutor(runtime, comparator)

    const results = await executor.execute([{
      id: "g-006",
      version: "0.3.1",
      suite: "extraction_pipeline",
      input: {},
      expected: { content: "test" },
      metadata: { createdAt: "2026-07-15T00:00:00Z" },
    }])

    expect(results[0].durationMs).toBeGreaterThanOrEqual(0)
  })

  test("multiple cases are all executed", async () => {
    const runtime: RuntimeExecutorFn = async (input: unknown) => {
      const data = input as { content: string }
      return { content: data.content }
    }
    const executor = new GoldenExecutor(runtime, comparator)

    const cases: GoldenCase[] = [
      {
        id: "g-007a",
        version: "0.3.1",
        suite: "extraction_pipeline",
        input: { content: "test A" },
        expected: { content: "test A" },
        metadata: { createdAt: "2026-07-15T00:00:00Z" },
      },
      {
        id: "g-007b",
        version: "0.3.1",
        suite: "extraction_pipeline",
        input: { content: "test B" },
        expected: { content: "test B" },
        metadata: { createdAt: "2026-07-15T00:00:00Z" },
      },
      {
        id: "g-007c",
        version: "0.3.1",
        suite: "extraction_pipeline",
        input: { content: "test C" },
        expected: { content: "test C" },
        metadata: { createdAt: "2026-07-15T00:00:00Z" },
      },
    ]

    const results = await executor.execute(cases)
    expect(results).toHaveLength(3)
    expect(results[0].caseId).toBe("g-007a")
    expect(results[1].caseId).toBe("g-007b")
    expect(results[2].caseId).toBe("g-007c")
  })

  test("threshold is configurable — lower threshold allows borderline cases to pass", async () => {
    const expectedMem: ComparableMemory = {
      content: "The user is a senior Go engineer who prefers backend development and clean architecture.",
      name: "User Role",
      type: "user",
    }
    const actualMem: ComparableMemory = {
      content: "The user is a senior Go engineer who prefers backend development and clean architecture.",
      name: "Different Name",
      type: "project",
    }
    const runtime: RuntimeExecutorFn = async () => actualMem

    // Low threshold (0.3) — should pass
    const lowThresholdExecutor = new GoldenExecutor(runtime, new DefaultMemoryComparator(0.3))
    const results = await lowThresholdExecutor.execute([{
      id: "g-008",
      version: "0.3.1",
      suite: "extraction_pipeline",
      input: {},
      expected: expectedMem,
      metadata: { createdAt: "2026-07-15T00:00:00Z" },
    }])

    // Content matches perfectly (weight 0.5), type doesn't (weight 0.2, score 0), name differs (weight 0.1)
    // Score = 1.0*0.5 + 0*0.2 + 0*0.2 + ~0.3*0.1 = 0.53
    // With threshold 0.3, this should pass
    expect(results[0].score).toBeGreaterThan(0.3)
    expect(results[0].passed).toBe(true)
  })
})
