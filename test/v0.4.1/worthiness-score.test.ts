/**
 * Tests for v0.4.1 Phase C1 — Worthiness Score
 */

import { describe, it, expect } from "vitest"
import {
  computeWorthiness,
  recommendationForScore,
  createFinding,
  type WorthinessScoreInput,
} from "../../src/validation/worthiness.js"
import type { MemoryProvenance } from "../../src/memory/provenance.js"

const DAY_MS = 24 * 60 * 60 * 1000

function makeUserProvenance(): MemoryProvenance {
  return {
    source: { type: "user", sessionId: "ses_1" },
    created: { timestamp: 1000, actor: "user" },
    extraction: { method: "explicit", confidenceScore: 1.0 },
    history: [{ action: "created", timestamp: 1000, actor: "user" }],
  }
}

function makeDefaultInput(): WorthinessScoreInput {
  return {
    contentQuality: 1.0,
    lifecycle: {
      status: "active",
      recallCount: 5,
      lastRecalledAt: new Date(Date.now() - DAY_MS).toISOString(),
      archivedAt: null,
      mtimeMs: Date.now(),
    },
    provenance: makeUserProvenance(),
    confidence: "explicit",
  }
}

describe("computeWorthiness", () => {
  it("all dimensions at 1 → score 1", () => {
    const result = computeWorthiness(makeDefaultInput())
    expect(result.worthinessScore).toBe(1.0)
    expect(result.recommendation).toBe("keep")
  })

  it("content quality 0 → score 0", () => {
    const input = makeDefaultInput()
    input.contentQuality = 0
    const result = computeWorthiness(input)
    expect(result.worthinessScore).toBe(0)
  })

  it("known value: 0.8 × 0.65 × 0.2 = 0.1", () => {
    const input = makeDefaultInput()
    input.contentQuality = 0.8
    input.lifecycle = {
      status: "active",
      recallCount: 0,
      lastRecalledAt: null,
      archivedAt: null,
      mtimeMs: Date.now(),
    }
    input.provenance = undefined
    // lifecycle: 0.5 (status) × 0.7 + 1.0 (stability) × 0.3 = 0.65
    // 0.8 × 0.65 × 0.2 = 0.104 → rounded to 0.1
    const result = computeWorthiness(input)
    expect(result.worthinessScore).toBeCloseTo(0.1, 1)
  })

  it("score 0.9 → recommendation keep", () => {
    expect(recommendationForScore(0.9)).toBe("keep")
  })

  it("score 0.6 → recommendation review", () => {
    expect(recommendationForScore(0.6)).toBe("review")
  })

  it("score 0.3 → recommendation archive", () => {
    expect(recommendationForScore(0.3)).toBe("archive")
  })

  it("score 0.1 → recommendation delete", () => {
    expect(recommendationForScore(0.1)).toBe("delete")
  })
})

describe("createFinding", () => {
  it("should create finding with correct structure", () => {
    const report = computeWorthiness(makeDefaultInput())
    const finding = createFinding(report)

    expect(finding.filename).toBeDefined()
    expect(finding.severity).toBeDefined()
    expect(finding.reasons).toHaveLength(3)
    expect(finding.suggestedAction).toBeDefined()
    expect(finding.createdAt).toBeGreaterThan(0)
  })

  it("high score → info severity, none action", () => {
    const report = computeWorthiness(makeDefaultInput())
    const finding = createFinding(report)
    expect(finding.severity).toBe("info")
    expect(finding.suggestedAction.type).toBe("none")
  })
})