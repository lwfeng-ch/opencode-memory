import { describe, test, expect } from "vitest"
import { DedupMetric, RecallAtKMetric, ConflictResolutionMetric, ObsoleteRateMetric, getMetricForSuite } from "../../benchmark/metrics.js"

describe("DedupMetric", () => {
  test("correct merge count returns score 1.0", () => {
    const metric = new DedupMetric()
    const result = metric.evaluate(
      { merged_count: 2, remaining: ["a"] },
      { merged_count: 2, remaining: ["a"] },
    )
    expect(result.score).toBe(1.0)
  })

  test("wrong merge count returns score < 1.0", () => {
    const metric = new DedupMetric()
    const result = metric.evaluate(
      { merged_count: 2, remaining: ["a"] },
      { merged_count: 1, remaining: ["a", "b"] },
    )
    expect(result.score).toBeLessThan(1.0)
  })
})

describe("RecallAtKMetric", () => {
  test("all hit returns score 1.0", () => {
    const metric = new RecallAtKMetric()
    const result = metric.evaluate(["a.md", "b.md"], ["a.md", "b.md"])
    expect(result.score).toBe(1.0)
    expect(result.details?.hit).toEqual(["a.md", "b.md"])
    expect(result.details?.miss).toEqual([])
  })

  test("partial hit returns correct score", () => {
    const metric = new RecallAtKMetric()
    const result = metric.evaluate(["a.md", "b.md", "c.md"], ["a.md", "b.md", "d.md"])
    expect(result.score).toBeCloseTo(0.667, 1)
    expect(result.details?.miss).toEqual(["c.md"])
  })

  test("no hit returns score 0", () => {
    const metric = new RecallAtKMetric()
    const result = metric.evaluate(["a.md"], ["b.md"])
    expect(result.score).toBe(0)
  })
})

describe("ConflictResolutionMetric", () => {
  test("correct returns 1.0", () => {
    const metric = new ConflictResolutionMetric()
    const result = metric.evaluate("python_new.md", "python_new.md")
    expect(result.score).toBe(1.0)
  })

  test("wrong returns 0.0", () => {
    const metric = new ConflictResolutionMetric()
    const result = metric.evaluate("python_new.md", "python_old.md")
    expect(result.score).toBe(0.0)
  })
})

describe("ObsoleteRateMetric", () => {
  test("all deprecated returns 1.0", () => {
    const metric = new ObsoleteRateMetric()
    const result = metric.evaluate(
      { deprecated: 5, should_deprecate: 5 },
      { deprecated: 5, should_deprecate: 5 },
    )
    expect(result.score).toBe(1.0)
  })

  test("no should-deprecate returns 1.0 (nothing to do)", () => {
    const metric = new ObsoleteRateMetric()
    const result = metric.evaluate(
      { deprecated: 0, should_deprecate: 0 },
      { deprecated: 0, should_deprecate: 0 },
    )
    expect(result.score).toBe(1.0)
  })

  test("partial returns correct ratio", () => {
    const metric = new ObsoleteRateMetric()
    const result = metric.evaluate(
      { deprecated: 5, should_deprecate: 5 },
      { deprecated: 4, should_deprecate: 5 },
    )
    expect(result.score).toBe(0.8)
  })
})

describe("getMetricForSuite", () => {
  test("returns correct metric for each suite", () => {
    expect(getMetricForSuite("dedup").name).toBe("ReductionRate")
    expect(getMetricForSuite("recall").name).toBe("Recall@5")
    expect(getMetricForSuite("conflict").name).toBe("ConflictResolutionRate")
    expect(getMetricForSuite("forgetting").name).toBe("ObsoleteRate")
    expect(getMetricForSuite("extraction_pipeline").name).toBe("ExtractionF1")
  })

  test("throws for unknown suite", () => {
    expect(() => getMetricForSuite("unknown")).toThrow("Unknown suite")
  })
})
