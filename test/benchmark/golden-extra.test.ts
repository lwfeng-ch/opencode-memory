/**
 * opencode-memory — Additional Golden Executor Edge Case Tests (v0.3.1)
 */

import { describe, test, expect } from "vitest"
import { GoldenExecutor, type GoldenCase } from "../../benchmark/executor/golden.js"
import { DefaultMemoryComparator, type ComparableMemory } from "../../src/evaluation/comparison.js"

function makeGoldenCase(overrides: Partial<GoldenCase> = {}): GoldenCase {
  return {
    id: "g-test",
    version: "0.3.1",
    suite: "extraction_pipeline",
    input: {},
    expected: { content: "test content", name: "Test", type: "user" },
    metadata: { createdAt: "2026-07-15T00:00:00Z" },
    ...overrides,
  }
}

describe("Golden executor edge cases", () => {
  test("threshold 0.5 allows borderline cases", async () => {
    const expected: ComparableMemory = { content: "User is a Go engineer.", type: "user" }
    const actual: ComparableMemory = { content: "User is a Go engineer.", type: "project" }
    // score = content 1.0*0.5 + desc 1.0*0.2 + type 0*0.2 + name 1.0*0.1 = 0.8
    const runtime = async () => actual
    const executor = new GoldenExecutor(runtime, new DefaultMemoryComparator(0.5))
    const results = await executor.execute([makeGoldenCase({ expected })])
    expect(results[0].passed).toBe(true)
  })

  test("string expected (non-ComparableMemory) uses text fallback", async () => {
    const expectedStr = "User prefers Python for AI development"
    const actualStr = "User prefers Python for AI development"
    const runtime = async () => actualStr
    const executor = new GoldenExecutor(runtime, new DefaultMemoryComparator(0.8))
    const results = await executor.execute([makeGoldenCase({ expected: expectedStr })])
    expect(results[0].score).toBe(1.0)
    expect(results[0].passed).toBe(true)
  })

  test("large batch — 10 cases all pass", async () => {
    const cases = Array.from({ length: 10 }, (_, i) => makeGoldenCase({
      id: `g-batch-${i}`,
      input: { data: `test-${i}` },
      expected: { content: `test-${i}`, name: `Test ${i}`, type: "user" },
    }))
    // Mock runtime: returns expected output for each input
    const expectedMap = new Map(cases.map((c) => [JSON.stringify(c.input), c.expected]))
    const runtime = async (input: unknown) => expectedMap.get(JSON.stringify(input)) ?? input
    const executor = new GoldenExecutor(runtime, new DefaultMemoryComparator(0.8))
    const results = await executor.execute(cases)
    expect(results).toHaveLength(10)
    expect(results.every((r) => r.passed)).toBe(true)
  })

  test("mixed ComparableMemory and string expected", async () => {
    const runtime = async () => "hello world"
    const executor = new GoldenExecutor(runtime, new DefaultMemoryComparator(0.8))
    const cases: GoldenCase[] = [
      makeGoldenCase({ id: "g-mem", expected: { content: "hello world", type: "user" } }),
      makeGoldenCase({ id: "g-str", expected: "hello world" }),
    ]
    const results = await executor.execute(cases)
    expect(results).toHaveLength(2)
    // The string case should pass (exact match)
    expect(results[1].passed).toBe(true)
  })

  test("error on one case does not affect others", async () => {
    let callCount = 0
    const runtime = async () => {
      callCount++
      if (callCount === 2) throw new Error("intermittent failure")
      return { content: "ok", type: "user" }
    }
    const executor = new GoldenExecutor(runtime, new DefaultMemoryComparator(0.8))
    const cases = Array.from({ length: 3 }, (_, i) => makeGoldenCase({
      id: `g-err-${i}`,
      expected: { content: "ok", type: "user" },
    }))
    const results = await executor.execute(cases)
    expect(results).toHaveLength(3)
    expect(results[0].passed).toBe(true)
    expect(results[1].passed).toBe(false)
    expect(results[1].error).toContain("intermittent")
    expect(results[2].passed).toBe(true)
  })

  test("custom comparator threshold affects pass rate", async () => {
    const expected: ComparableMemory = { content: "hello world", type: "user" }
    const actual: ComparableMemory = { content: "hello world", type: "project" }
    const runtime = async () => actual

    // Strict threshold (0.9) — type mismatch should fail
    const strict = new GoldenExecutor(runtime, new DefaultMemoryComparator(0.9))
    const strictResults = await strict.execute([makeGoldenCase({ expected })])
    // score = 1.0*0.5 + 1.0*0.2 + 0*0.2 + 1.0*0.1 = 0.8 < 0.9 → fail
    expect(strictResults[0].passed).toBe(false)

    // Lenient threshold (0.7) — should pass
    const lenient = new GoldenExecutor(runtime, new DefaultMemoryComparator(0.7))
    const lenientResults = await lenient.execute([makeGoldenCase({ expected })])
    expect(lenientResults[0].passed).toBe(true)
  })

  test("duration increases with more cases", async () => {
    const runtime = async () => ({ content: "test", type: "user" })
    const executor = new GoldenExecutor(runtime, new DefaultMemoryComparator(0.8))

    const single = await executor.execute([makeGoldenCase({ id: "g-dur-1" })])
    const multiple = await executor.execute(Array.from({ length: 5 }, (_, i) => makeGoldenCase({ id: `g-dur-${i}` })))

    // Multiple cases should have total duration >= single case
    const totalMultiple = multiple.reduce((sum, r) => sum + r.durationMs, 0)
    expect(totalMultiple).toBeGreaterThanOrEqual(single[0].durationMs)
  })
})
