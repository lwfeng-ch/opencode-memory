/**
 * opencode-memory — Additional Quality Score Edge Case Tests (v0.3.1)
 */

import { describe, test, expect } from "vitest"
import { DefaultMemoryQualityEvaluator, type QualityMemory } from "../../src/evaluation/quality-score.js"
import { checkCompleteness, checkConsistency, checkFreshness, checkNoise, checkRetrievability } from "../../src/evaluation/quality.js"

function makeMem(overrides: Partial<QualityMemory> = {}): QualityMemory {
  return {
    filename: "test.md",
    content: "Well-written memory content about user preferences.",
    name: "Test Memory",
    description: "A test memory",
    type: "user",
    scope: "user",
    confidence: "explicit",
    recallCount: 5,
    lastRecalledAt: new Date().toISOString(),
    mtimeMs: Date.now(),
    ...overrides,
  }
}

describe("Quality score edge cases", () => {
  test("mixed completeness — half complete, half not", () => {
    const memories = [
      makeMem({ filename: "a.md" }),
      makeMem({ filename: "b.md", name: undefined, description: null }),
    ]
    const score = checkCompleteness(memories)
    expect(score).toBe(50)
  })

  test("consistency with 3 duplicate memories", () => {
    const content = "User prefers Python for AI development and machine learning."
    const memories = [
      makeMem({ filename: "a.md", content }),
      makeMem({ filename: "b.md", content }),
      makeMem({ filename: "c.md", content }),
    ]
    const score = checkConsistency(memories)
    // 3 pairs out of 3 max → high penalty
    expect(score).toBeLessThan(50)
  })

  test("freshness — explicit confidence never stale even if old", () => {
    const old = Date.now() - 365 * 24 * 60 * 60 * 1000
    const memories = [makeMem({ mtimeMs: old, recallCount: 0, lastRecalledAt: null, confidence: "explicit" })]
    const score = checkFreshness(memories, Date.now())
    expect(score).toBe(100)
  })

  test("noise — multiple issues in one memory", () => {
    const memories = [makeMem({ name: "Explicit Feedback", content: "TODO: fill this in" })]
    const score = checkNoise(memories)
    expect(score).toBe(0)
  })

  test("retrievability — mixed recall counts", () => {
    const memories = [
      makeMem({ filename: "a.md", recallCount: 10 }),
      makeMem({ filename: "b.md", recallCount: 0, lastRecalledAt: null }),
      makeMem({ filename: "c.md", recallCount: 3 }),
      makeMem({ filename: "d.md", recallCount: 0, lastRecalledAt: null }),
    ]
    const score = checkRetrievability(memories)
    expect(score).toBe(50) // 2 out of 4 recalled
  })

  test("overall score with all dimensions at 100 → overall = 100", () => {
    const evaluator = new DefaultMemoryQualityEvaluator()
    const memories = [makeMem()]
    const report = evaluator.evaluate(memories)
    expect(report.overall).toBe(100)
  })

  test("overall score with all noise → overall < 50", () => {
    const evaluator = new DefaultMemoryQualityEvaluator()
    const memories = [makeMem({ name: "Explicit Feedback", content: "TODO: fix", description: null, type: undefined, scope: undefined, confidence: undefined, recallCount: 0, lastRecalledAt: null })]
    const report = evaluator.evaluate(memories)
    expect(report.overall).toBeLessThan(50)
  })

  test("large memory set — 50 memories with unique content", () => {
    const evaluator = new DefaultMemoryQualityEvaluator()
    const memories = Array.from({ length: 50 }, (_, i) => makeMem({
      filename: `mem-${i}.md`,
      content: `Topic${i}: Specific context about unique subject ${i} with distinct keywords.`,
      name: `Memory ${i}`,
    }))
    const report = evaluator.evaluate(memories)
    // Each memory has unique "topicN" keyword, others shared → Jaccard < 0.8 → no merges
    expect(report.dimensions.consistency).toBe(100)
    expect(report.overall).toBe(100)
  })
})
