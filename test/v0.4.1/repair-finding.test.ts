/**
 * Tests for v0.4.1 Phase C2 — Repair Integration (ValidationFinding)
 */

import { describe, it, expect } from "vitest"
import { createFinding, computeWorthiness, type WorthinessScoreInput } from "../../src/validation/worthiness.js"
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

function makeInput(overrides: Partial<WorthinessScoreInput> = {}): WorthinessScoreInput {
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
    ...overrides,
  }
}

describe("severity mapping", () => {
  it("high score → info severity, none action", () => {
    const report = computeWorthiness(makeInput({ contentQuality: 0.9 }))
    const finding = createFinding(report)
    expect(finding.severity).toBe("info")
    expect(finding.suggestedAction.type).toBe("none")
  })

  it("low score → critical severity, delete action", () => {
    const report = computeWorthiness(makeInput({
      contentQuality: 0.5,
      lifecycle: {
        status: "archived",
        recallCount: 0,
        lastRecalledAt: null,
        archivedAt: Date.now() - 200 * DAY_MS,
        mtimeMs: Date.now(),
      },
      provenance: undefined,
    }))
    const finding = createFinding(report)
    expect(finding.worthinessScore).toBeLessThan(0.5)
    expect(finding.suggestedAction.type).toBeDefined()
  })

  it("forced score 0.1 → critical severity, delete action", () => {
    const report = computeWorthiness(makeInput())
    const finding = createFinding({
      ...report,
      worthinessScore: 0.1,
    })
    expect(finding.severity).toBe("critical")
    expect(finding.suggestedAction.type).toBe("delete")
  })
})

describe("finding structure", () => {
  it("finding has 3 reasons", () => {
    const report = computeWorthiness(makeInput())
    const finding = createFinding(report)
    expect(finding.reasons).toHaveLength(3)
    expect(finding.reasons[0].dimension).toBe("content")
    expect(finding.reasons[1].dimension).toBe("lifecycle")
    expect(finding.reasons[2].dimension).toBe("provenance")
  })

  it("finding has valid metadata", () => {
    const report = computeWorthiness(makeInput())
    const finding = createFinding(report, "project")
    expect(finding.id).toBeTruthy()
    expect(finding.createdAt).toBeGreaterThan(0)
    expect(finding.scope).toBe("project")
  })
})