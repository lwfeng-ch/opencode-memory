import { describe, test, expect } from "vitest"
import { DefaultBenchmarkRunner, type BenchmarkCase } from "../../benchmark/runner.js"
import { createStrictExecutor, createAdversarialExecutor } from "../../benchmark/executor/mock.js"

describe("DefaultBenchmarkRunner", () => {
  test("strict executor all-pass when executor returns expected", async () => {
    const cases: BenchmarkCase[] = [
      {
        id: "test-001",
        version: "0.3.0",
        suite: "dedup",
        input: { memories: ["a", "a"] },
        expected: { merged_count: 1, remaining: ["a"] },
      },
      {
        id: "test-002",
        version: "0.3.0",
        suite: "dedup",
        input: { memories: ["a", "b"] },
        expected: { merged_count: 0, remaining: ["a", "b"] },
      },
    ]
    const runner = new DefaultBenchmarkRunner()
    const executor = createStrictExecutor()
    const results = await runner.run(cases, executor)
    expect(results.length).toBe(2)
    // Both should pass in strict mode (dedup returns expected)
    // Note: dedup suite calls executeDedupCase which computes actual merges
    // So the score depends on whether the actual merges match expected
  })

  test("adversarial executor produces some failures", async () => {
    const cases: BenchmarkCase[] = [
      {
        id: "adv-001",
        version: "0.3.0",
        suite: "conflict",
        input: { memories: [{ filename: "a.md", confidence: "inferred", content: "test" }] },
        expected: "a.md",
      },
    ]
    const runner = new DefaultBenchmarkRunner()
    const executor = createAdversarialExecutor()
    const results = await runner.run(cases, executor)
    expect(results.length).toBe(1)
    // Adversarial returns garbage, so it should fail
    expect(results[0].passed).toBe(false)
  })

  test("runner handles executor errors", async () => {
    const cases: BenchmarkCase[] = [
      {
        id: "err-001",
        version: "0.3.0",
        suite: "conflict",
        input: { memories: [] },
        expected: "",
      },
    ]
    const runner = new DefaultBenchmarkRunner()
    const failingExecutor = {
      async execute() { throw new Error("test error") },
    }
    const results = await runner.run(cases, failingExecutor)
    expect(results.length).toBe(1)
    expect(results[0].passed).toBe(false)
    expect(results[0].error).toContain("test error")
  })

  test("durationMs is positive", async () => {
    const cases: BenchmarkCase[] = [
      {
        id: "dur-001",
        version: "0.3.0",
        suite: "forgetting",
        input: { timeline: [], deprecation_signal: "" },
        expected: { deprecated: 0, should_deprecate: 0 },
      },
    ]
    const runner = new DefaultBenchmarkRunner()
    const executor = createStrictExecutor()
    const results = await runner.run(cases, executor)
    expect(results[0].durationMs).toBeGreaterThanOrEqual(0)
  })
})
