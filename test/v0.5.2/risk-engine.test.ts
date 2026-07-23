/**
 * v0.5.2 — RiskEngine Tests
 * 8 tests: low/medium/high/fact-evidence/auto-execute/candidate/repair/boundary
 */

import { describe, it, expect } from "vitest"
import { RiskEngine } from "../../src/safe-execution/risk.js"
import type { ConsolidationCandidate } from "../../src/dream/candidate/types.js"
import type { RepairCandidate } from "../../src/repair/candidate.js"

describe("RiskEngine", () => {
  const engine = new RiskEngine()

  function makeCandidate(overrides: Partial<ConsolidationCandidate> = {}): ConsolidationCandidate {
    return {
      id: "c1", clusterId: "cl1", action: "archive", targets: ["a.md"],
      evidence: { clusterId: "cl1", members: [] },
      expectedGain: 0.5, riskHint: 0.1, confidence: 0.85,
      ...overrides,
    }
  }

  function makeRepair(overrides: Partial<RepairCandidate> = {}): RepairCandidate {
    return {
      id: "r1", type: "lifecycle_archive", action: "archive", source: "a.md",
      reason: "test", metadata: { size: 0, createdAt: 0, lastModified: 0 },
      preview: { title: "", description: "", sections: [] },
      risk: "low", status: "pending", createdAt: 0,
      ...overrides,
    }
  }

  it("1. high confidence archive → low risk", () => {
    const result = engine.assessCandidate(makeCandidate({ confidence: 0.95, riskHint: 0.05 }))
    expect(result.label).toBe("low")
    expect(result.autoExecutable).toBe(true)
  })

  it("2. low confidence delete → high risk", () => {
    const result = engine.assessRepair(makeRepair({ action: "delete", risk: "high" }))
    expect(result.label).toBe("high")
    expect(result.autoExecutable).toBe(false)
  })

  it("3. medium risk archive → auto-executable (low score)", () => {
    const result = engine.assessRepair(makeRepair({ action: "archive", risk: "medium" }))
    // archive + medium risk → score < 0.3 → autoExecutable = true
    expect(result.score).toBeLessThan(0.3)
    expect(result.autoExecutable).toBe(true)
  })

  it("4. fact evidence — user input reduces risk", () => {
    const without = engine.assessCandidate(makeCandidate(), { factEvidence: { hasDirectUserInput: false, totalSessions: 1 } })
    const with_user = engine.assessCandidate(makeCandidate(), { factEvidence: { hasDirectUserInput: true, totalSessions: 3 } })
    expect(with_user.score).toBeLessThanOrEqual(without.score)
  })

  it("5. auto-executable threshold", () => {
    const low = engine.assessCandidate(makeCandidate({ confidence: 0.95, riskHint: 0.05 }))
    const high = engine.assessRepair(makeRepair({ action: "delete", risk: "high" }))
    expect(low.autoExecutable).toBe(true)
    expect(high.autoExecutable).toBe(false)
  })

  it("6. ConsolidationCandidate assessment", () => {
    const result = engine.assessCandidate(makeCandidate({ action: "archive", confidence: 0.8, riskHint: 0.2 }))
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(1)
    expect(result.blastRadius).toBe(1)
  })

  it("7. RepairCandidate assessment", () => {
    const result = engine.assessRepair(makeRepair({ action: "archive", risk: "medium" }))
    expect(result.impact).toBeGreaterThan(0)
    expect(result.reversibility).toBe("easy")
  })

  it("8. boundary values — score clamped 0-1", () => {
    const result = engine.assessCandidate(makeCandidate({ confidence: 0, riskHint: 1.0 }))
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(1)
  })
})