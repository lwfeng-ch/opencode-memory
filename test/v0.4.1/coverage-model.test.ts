/**
 * Tests for v0.4.1 Phase B1 — CoverageModel
 */

import { describe, it, expect } from "vitest"
import {
  LinearBufferedCoverage,
  SqrtCoverage,
  LogCoverage,
  selectCoverageModel,
  type CoverageModel,
} from "../../src/validation/coverage-model.js"

describe("LinearBufferedCoverage", () => {
  const model = new LinearBufferedCoverage()

  it("10/20 → 0.5 + 0.5×0.5 = 0.75", () => {
    expect(model.calculate(10, 20)).toBe(0.75)
  })

  it("0/20 → 0.5 (minimum buffer)", () => {
    expect(model.calculate(0, 20)).toBe(0.5)
  })

  it("20/20 → 1.0", () => {
    expect(model.calculate(20, 20)).toBe(1.0)
  })

  it("0/0 → 1.0 (edge case)", () => {
    expect(model.calculate(0, 0)).toBe(1.0)
  })
})

describe("SqrtCoverage", () => {
  const model = new SqrtCoverage()

  it("50/200 → sqrt(0.25) ≈ 0.5", () => {
    expect(model.calculate(50, 200)).toBeCloseTo(0.5, 2)
  })

  it("100/200 → sqrt(0.5) ≈ 0.707", () => {
    expect(model.calculate(100, 200)).toBeCloseTo(0.707, 2)
  })
})

describe("LogCoverage", () => {
  const model = new LogCoverage()

  it("100/1000 → log(101)/log(1001) ≈ 0.67", () => {
    const result = model.calculate(100, 1000)
    expect(result).toBeGreaterThan(0.6)
    expect(result).toBeLessThan(0.75)
  })

  it("500/1000 → log(501)/log(1001) ≈ 0.91", () => {
    const result = model.calculate(500, 1000)
    expect(result).toBeGreaterThan(0.85)
    expect(result).toBeLessThan(0.95)
  })
})

describe("selectCoverageModel", () => {
  it("total=50 → LinearBufferedCoverage", () => {
    const model = selectCoverageModel(50)
    expect(model).toBeInstanceOf(LinearBufferedCoverage)
  })

  it("total=500 → SqrtCoverage", () => {
    const model = selectCoverageModel(500)
    expect(model).toBeInstanceOf(SqrtCoverage)
  })

  it("total=2000 → LogCoverage", () => {
    const model = selectCoverageModel(2000)
    expect(model).toBeInstanceOf(LogCoverage)
  })
})

describe("Custom model via interface", () => {
  it("should work with custom model", () => {
    const custom: CoverageModel = {
      name: "custom",
      calculate(active: number, total: number) {
        return active / total
      },
    }
    expect(custom.calculate(5, 10)).toBe(0.5)
    expect(custom.name).toBe("custom")
  })
})