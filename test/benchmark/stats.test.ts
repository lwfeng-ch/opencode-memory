import { describe, test, expect } from "vitest"
import { computeStats } from "../../benchmark/stats.js"

describe("computeStats", () => {
  test("n=0 returns zeros", () => {
    const result = computeStats([])
    expect(result).toEqual({
      mean: 0,
      stddev: 0,
      ci95: [0, 0],
      n: 0,
      scores: [],
    })
  })

  test("n=1 collapses ci95 to the single score", () => {
    const result = computeStats([0.85])
    expect(result.mean).toBe(0.85)
    expect(result.stddev).toBe(0)
    expect(result.ci95).toEqual([0.85, 0.85])
    expect(result.n).toBe(1)
    expect(result.scores).toEqual([0.85])
  })

  test("n=2 computes correct values", () => {
    const result = computeStats([0.8, 1.0])
    expect(result.mean).toBe(0.9)
    expect(result.n).toBe(2)
    expect(result.scores).toEqual([0.8, 1.0])
    // variance = ((0.8-0.9)^2 + (1.0-0.9)^2) / 2 = (0.01 + 0.01) / 2 = 0.01
    // stddev = sqrt(0.01) = 0.1
    expect(result.stddev).toBeCloseTo(0.1, 10)
    // margin = 1.96 * 0.1 / sqrt(2) = 1.96 * 0.1 / 1.4142 = 0.1386
    // ci95 = [0.9 - 0.1386, 0.9 + 0.1386] = [0.7614, 1.0386]
    expect(result.ci95[0]).toBeCloseTo(0.9 - 1.96 * 0.1 / Math.sqrt(2), 4)
    expect(result.ci95[1]).toBeCloseTo(0.9 + 1.96 * 0.1 / Math.sqrt(2), 4)
  })

  test("n=3 with known values", () => {
    const result = computeStats([0.82, 0.87, 0.79])
    expect(result.n).toBe(3)
    // mean = (0.82 + 0.87 + 0.79) / 3 = 2.48 / 3 = 0.8267
    expect(result.mean).toBeCloseTo(0.8267, 3)
    // variance = ((0.82-0.8267)^2 + (0.87-0.8267)^2 + (0.79-0.8267)^2) / 3
    // = (0.0000449 + 0.0018769 + 0.0013449) / 3 = 0.0032667 / 3 = 0.0010889
    // stddev = sqrt(0.0010889) = 0.0330
    expect(result.stddev).toBeCloseTo(0.033, 2)
    // margin = 1.96 * 0.0330 / sqrt(3) = 1.96 * 0.01905 = 0.03733
    // ci95: [0.8267 - 0.0373, 0.8267 + 0.0373] = [0.7894, 0.8640]
    const margin = 1.96 * result.stddev / Math.sqrt(3)
    expect(result.ci95[0]).toBeCloseTo(result.mean - margin, 3)
    expect(result.ci95[1]).toBeCloseTo(result.mean + margin, 3)
    expect(result.scores).toEqual([0.82, 0.87, 0.79])
  })

  test("n=3 with identical scores (stddev=0)", () => {
    const result = computeStats([0.9, 0.9, 0.9])
    expect(result.mean).toBe(0.9)
    expect(result.stddev).toBe(0)
    // When stddev=0, margin = 0, ci95 = [mean, mean]
    expect(result.ci95).toEqual([0.9, 0.9])
    expect(result.n).toBe(3)
  })

  test("works with negative scores", () => {
    const result = computeStats([-1, 0, 1])
    expect(result.mean).toBe(0)
    expect(result.stddev).toBeCloseTo(Math.sqrt(2 / 3), 5)
    expect(result.n).toBe(3)
  })

  test("works with large values", () => {
    const result = computeStats([100, 200, 300])
    expect(result.mean).toBe(200)
    // variance = (10000 + 0 + 10000) / 3 = 6666.67
    // stddev = 81.65
    expect(result.stddev).toBeCloseTo(81.65, 0)
    expect(result.n).toBe(3)
  })

  test("returns copy of scores array", () => {
    const scores = [0.8, 0.9]
    const result = computeStats(scores)
    // The result should not be the same reference
    result.scores.push(1.0)
    expect(scores.length).toBe(2)
  })
})
