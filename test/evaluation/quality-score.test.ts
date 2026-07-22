/**
 * opencode-memory — Memory Quality Score Tests (v0.3.1)
 *
 * Tests the 5-dimension quality evaluator:
 *   Completeness (20%) — name, description, frontmatter fields
 *   Consistency (25%)  — duplicate + conflict detection
 *   Freshness (15%)    — recallCount, lastRecalledAt, mtimeMs
 *   Noise (20%)        — placeholder, garbage, generic names
 *   Retrievability (20%) — recall score distribution
 */

import { describe, test, expect } from "vitest"
import {
  DefaultMemoryQualityEvaluator,
  type QualityMemory,
  type QualityReportV2,
  type MemoryQualityEvaluator,
} from "../../src/evaluation/quality-score.js"
import {
  checkCompleteness,
  checkNoise,
  checkFreshness,
  checkRetrievability,
  checkConsistency,
} from "../../src/evaluation/quality.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMemory(overrides: Partial<QualityMemory> = {}): QualityMemory {
  return {
    filename: "test-memory.md",
    content: "This is a well-written memory about the user's preferences.",
    name: "Test Memory",
    description: "A test memory for quality scoring",
    type: "user",
    scope: "user",
    confidence: "explicit",
    recallCount: 5,
    lastRecalledAt: new Date().toISOString(),
    mtimeMs: Date.now(),
    ...overrides,
  }
}

const now = Date.now()
const DAY = 24 * 60 * 60 * 1000

// ---------------------------------------------------------------------------
// QualityReport structure
// ---------------------------------------------------------------------------

describe("QualityReport structure (v0.3.4 lifecycle-aware)", () => {
  test("evaluate returns QualityReportV2 with activeQuality + archiveHygiene + gateScore", () => {
    const evaluator = new DefaultMemoryQualityEvaluator()
    const report = evaluator.evaluate([makeMemory()])
    expect(report).toHaveProperty("activeQuality")
    expect(report).toHaveProperty("archiveHygiene")
    expect(report).toHaveProperty("gateScore")
    expect(report).toHaveProperty("overall")
    expect(report.activeQuality).toHaveProperty("dimensions")
    expect(report.activeQuality.dimensions).toHaveProperty("completeness")
    expect(report.activeQuality.dimensions).toHaveProperty("consistency")
    expect(report.activeQuality.dimensions).toHaveProperty("freshness")
    expect(report.activeQuality.dimensions).toHaveProperty("noise")
    expect(report.activeQuality.dimensions).toHaveProperty("retrievability")
    expect(typeof report.overall).toBe("number")
  })

  test("empty memory list returns activeQuality=100, gateScore=100 (empty = perfect coverage)", () => {
    const evaluator = new DefaultMemoryQualityEvaluator()
    const report = evaluator.evaluate([])
    expect(report.activeQuality.score).toBe(100)
    expect(report.gateScore).toBe(100)
  })
})

// ---------------------------------------------------------------------------
// Completeness (20%)
// ---------------------------------------------------------------------------

describe("Completeness dimension", () => {
  test("all fields present → completeness=100", () => {
    const score = checkCompleteness([makeMemory()])
    expect(score).toBe(100)
  })

  test("missing name → completeness < 100", () => {
    const score = checkCompleteness([makeMemory({ name: undefined })])
    expect(score).toBeLessThan(100)
  })

  test("missing description → completeness < 100", () => {
    const score = checkCompleteness([makeMemory({ description: null })])
    expect(score).toBeLessThan(100)
  })
})

// ---------------------------------------------------------------------------
// Consistency (25%)
// ---------------------------------------------------------------------------

describe("Consistency dimension", () => {
  test("no duplicates → consistency=100", () => {
    const memories = [
      makeMemory({ filename: "a.md", content: "User likes Python for AI." }),
      makeMemory({ filename: "b.md", content: "Project uses React frontend." }),
    ]
    const score = checkConsistency(memories)
    expect(score).toBe(100)
  })

  test("with duplicates → consistency < 100", () => {
    const memories = [
      makeMemory({ filename: "a.md", content: "User prefers Python for AI development." }),
      makeMemory({ filename: "b.md", content: "User prefers Python for AI development." }),
    ]
    const score = checkConsistency(memories)
    expect(score).toBeLessThan(100)
  })
})

// ---------------------------------------------------------------------------
// Freshness (15%)
// ---------------------------------------------------------------------------

describe("Freshness dimension", () => {
  test("recent memories with high recall → freshness=100", () => {
    const memories = [makeMemory({
      mtimeMs: now,
      recallCount: 10,
      lastRecalledAt: new Date(now).toISOString(),
    })]
    const score = checkFreshness(memories, now)
    expect(score).toBe(100)
  })

  test("stale memories (old, never recalled) → freshness < 100", () => {
    const memories = [makeMemory({
      mtimeMs: now - 200 * DAY, // 200 days old
      recallCount: 0,
      lastRecalledAt: null,
      confidence: "inferred", // NOT explicit — explicit memories are never stale
    })]
    const score = checkFreshness(memories, now)
    expect(score).toBeLessThan(100)
  })
})

// ---------------------------------------------------------------------------
// Noise (20%)
// ---------------------------------------------------------------------------

describe("Noise dimension", () => {
  test("clean content → noise=100", () => {
    const score = checkNoise([makeMemory({ content: "User is a senior Go engineer." })])
    expect(score).toBe(100)
  })

  test("placeholder content → noise < 100", () => {
    const score = checkNoise([makeMemory({ content: "TODO: fill this in" })])
    expect(score).toBeLessThan(100)
  })

  test("generic name → noise < 100", () => {
    const score = checkNoise([makeMemory({ name: "Explicit Feedback" })])
    expect(score).toBeLessThan(100)
  })
})

// ---------------------------------------------------------------------------
// Retrievability (20%)
// ---------------------------------------------------------------------------

describe("Retrievability dimension", () => {
  test("all recalled → retrievability=100", () => {
    const memories = [
      makeMemory({ filename: "a.md", recallCount: 5 }),
      makeMemory({ filename: "b.md", recallCount: 3 }),
    ]
    const score = checkRetrievability(memories)
    expect(score).toBe(100)
  })

  test("none recalled → retrievability < 100", () => {
    const memories = [
      makeMemory({ filename: "a.md", recallCount: 0, lastRecalledAt: null }),
      makeMemory({ filename: "b.md", recallCount: 0, lastRecalledAt: null }),
    ]
    const score = checkRetrievability(memories)
    expect(score).toBeLessThan(100)
  })
})

// ---------------------------------------------------------------------------
// Overall weighted score
// ---------------------------------------------------------------------------

describe("Overall score aggregation (v0.3.4)", () => {
  test("activeQuality.score is weighted average of 5 dimensions", () => {
    const evaluator = new DefaultMemoryQualityEvaluator()
    const report = evaluator.evaluate([makeMemory()])
    const expected = Math.round(
      report.activeQuality.dimensions.completeness * 0.20 +
      report.activeQuality.dimensions.consistency * 0.25 +
      report.activeQuality.dimensions.freshness * 0.15 +
      report.activeQuality.dimensions.noise * 0.20 +
      report.activeQuality.dimensions.retrievability * 0.20
    )
    expect(report.activeQuality.score).toBe(expected)
  })
})
