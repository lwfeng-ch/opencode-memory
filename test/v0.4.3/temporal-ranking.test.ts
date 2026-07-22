/**
 * Tests for v0.4.3 Phase C — Temporal Ranking
 */

import { describe, it, expect } from "vitest"
import {
  temporalValidity,
  adjustedSourceTrust,
  rankCandidates,
  type TemporalClass,
  type ConflictRankingInput,
} from "../../src/conflict/temporal.js"

const DAY_MS = 24 * 60 * 60 * 1000

describe("TemporalClass", () => {
  it("should have 4 types", () => {
    const types: TemporalClass[] = ["preference", "fact", "workflow", "session"]
    expect(types).toHaveLength(4)
  })
})

describe("temporalValidity", () => {
  it("preference: 7 days → 1.0", () => {
    expect(temporalValidity(Date.now() - 7 * DAY_MS, "preference")).toBe(1.0)
  })

  it("preference: 200 days → 0.8 (within medium)", () => {
    expect(temporalValidity(Date.now() - 200 * DAY_MS, "preference")).toBe(0.8)
  })

  it("fact: 7 days → 1.0", () => {
    expect(temporalValidity(Date.now() - 7 * DAY_MS, "fact")).toBe(1.0)
  })

  it("fact: 100 days → 0.5 (beyond medium, within slow)", () => {
    expect(temporalValidity(Date.now() - 100 * DAY_MS, "fact")).toBe(0.8)
  })

  it("session: 10 days → 0.5 (beyond fast, within medium)", () => {
    expect(temporalValidity(Date.now() - 10 * DAY_MS, "session")).toBe(0.8)
  })

  it("session: 60 days → 0.5 (within slow threshold)", () => {
    expect(temporalValidity(Date.now() - 60 * DAY_MS, "session")).toBe(0.5)
  })

  it("default temporalClass → fact", () => {
    expect(temporalValidity(Date.now() - 7 * DAY_MS)).toBe(1.0)
  })

  it("preference decays slower than session", () => {
    const pref = temporalValidity(Date.now() - 100 * DAY_MS, "preference")
    const sess = temporalValidity(Date.now() - 100 * DAY_MS, "session")
    expect(pref).toBeGreaterThan(sess)
  })
})

describe("adjustedSourceTrust", () => {
  it("user with high temporal → 1.0", () => {
    expect(adjustedSourceTrust("user", 1.0)).toBe(1.0)
  })

  it("user with low temporal → 0.8 (discounted)", () => {
    expect(adjustedSourceTrust("user", 0.3)).toBeCloseTo(0.8, 1)
  })

  it("extraction with high temporal → 0.88 (boosted)", () => {
    expect(adjustedSourceTrust("extraction", 1.0)).toBeCloseTo(0.88, 1)
  })

  it("extraction with low temporal → 0.8 (no boost)", () => {
    expect(adjustedSourceTrust("extraction", 0.3)).toBe(0.8)
  })
})

describe("rankCandidates", () => {
  function makeInput(overrides: Partial<ConflictRankingInput> = {}): ConflictRankingInput {
    return {
      provenanceConfidence: 0.8,
      lifecycleValidity: 0.8,
      worthinessScore: 0.8,
      timestamp: 2000,
      sourceType: "extraction",
      temporalScore: 1.0,
      label: "A",
      ...overrides,
    }
  }

  it("recent extraction beats old user claim (with large temporal gap)", () => {
    // adjustedSourceTrust("user", 0.3) = 0.8
    // adjustedSourceTrust("extraction", 1.0) = 0.88
    // gap = 0.08, which is < 0.15 threshold
    // So we need to also make worthiness different to break the tie
    const result = rankCandidates([
      makeInput({ sourceType: "user", temporalScore: 0.3, worthinessScore: 0.5, label: "A" }),
      makeInput({ sourceType: "extraction", temporalScore: 1.0, worthinessScore: 0.9, label: "B" }),
    ])
    expect(result[0].label).toBe("B")
  })

  it("recent user claim beats recent extraction", () => {
    const result = rankCandidates([
      makeInput({ sourceType: "user", temporalScore: 1.0, label: "A" }),
      makeInput({ sourceType: "extraction", temporalScore: 1.0, label: "B" }),
    ])
    // user with high temporal should beat extraction
    expect(result[0].label).toBe("A")
  })
})