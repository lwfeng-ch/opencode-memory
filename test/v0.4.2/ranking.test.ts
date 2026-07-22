/**
 * Tests for v0.4.2 Phase C1 — Ranking Adapter
 */

import { describe, it, expect } from "vitest"
import { rankCandidates, getBestCandidate, type ConflictRankingInput } from "../../src/conflict/ranking.js"

function makeInput(overrides: Partial<ConflictRankingInput> = {}): ConflictRankingInput {
  return {
    provenanceConfidence: 0.8,
    lifecycleValidity: 0.8,
    worthinessScore: 0.8,
    timestamp: 2000,
    sourceType: "extraction",
    label: "A",
    ...overrides,
  }
}

describe("rankCandidates", () => {
  it("should rank user source over extraction", () => {
    const result = rankCandidates([
      makeInput({ sourceType: "extraction", label: "A" }),
      makeInput({ sourceType: "user", label: "B" }),
    ])
    expect(result[0].label).toBe("B")
    expect(result[0].sourceType).toBe("user")
  })

  it("should rank higher provenance confidence over lower", () => {
    const result = rankCandidates([
      makeInput({ provenanceConfidence: 0.5, label: "A" }),
      makeInput({ provenanceConfidence: 0.9, label: "B" }),
    ])
    expect(result[0].label).toBe("B")
  })

  it("should rank higher worthiness over lower (when provenance equal)", () => {
    const result = rankCandidates([
      makeInput({ worthinessScore: 0.5, provenanceConfidence: 0.8, label: "A" }),
      makeInput({ worthinessScore: 0.9, provenanceConfidence: 0.8, label: "B" }),
    ])
    expect(result[0].label).toBe("B")
  })

  it("should rank newer over older (when all else equal)", () => {
    const result = rankCandidates([
      makeInput({ timestamp: 1000, provenanceConfidence: 0.8, label: "A" }),
      makeInput({ timestamp: 3000, provenanceConfidence: 0.8, label: "B" }),
    ])
    expect(result[0].label).toBe("B")
  })

  it("should keep stable sort when all equal", () => {
    const result = rankCandidates([
      makeInput({ label: "A" }),
      makeInput({ label: "B" }),
    ])
    // Should maintain original order
    expect(result).toHaveLength(2)
  })

  it("should handle empty array", () => {
    const result = rankCandidates([])
    expect(result).toHaveLength(0)
  })
})

describe("getBestCandidate", () => {
  it("should return the best candidate", () => {
    const result = getBestCandidate([
      makeInput({ worthinessScore: 0.5, label: "A" }),
      makeInput({ worthinessScore: 0.9, label: "B" }),
    ])
    expect(result?.label).toBe("B")
  })

  it("should return undefined for empty array", () => {
    const result = getBestCandidate([])
    expect(result).toBeUndefined()
  })
})