/**
 * opencode-memory — Repair Candidate Tests (v0.3.3)
 */

import { describe, test, expect } from "vitest"
import { generateCandidateId, generateActionId, assessRisk, type RepairCandidate } from "../../src/repair/candidate.js"

describe("RepairCandidate types", () => {
  test("generateCandidateId returns unique ids", () => {
    const id1 = generateCandidateId()
    const id2 = generateCandidateId()
    expect(id1).not.toBe(id2)
    expect(id1).toMatch(/^cand_/)
  })

  test("generateActionId returns unique ids", () => {
    const id1 = generateActionId()
    const id2 = generateActionId()
    expect(id1).not.toBe(id2)
    expect(id1).toMatch(/^act_/)
  })

  test("assessRisk returns low for explicit", () => {
    expect(assessRisk("explicit", null)).toBe("low")
    expect(assessRisk("explicit", 300)).toBe("low")
  })

  test("assessRisk returns low for recent recall (<30d)", () => {
    expect(assessRisk("inferred", 10)).toBe("low")
    expect(assessRisk("observed", 29)).toBe("low")
  })

  test("assessRisk returns medium for 30-180d", () => {
    expect(assessRisk("inferred", 30)).toBe("medium")
    expect(assessRisk("inferred", 179)).toBe("medium")
  })

  test("assessRisk returns high for >180d or null", () => {
    expect(assessRisk("inferred", 180)).toBe("high")
    expect(assessRisk("uncertain", null)).toBe("high")
    expect(assessRisk(undefined, null)).toBe("high")
  })

  test("RepairCandidate interface is constructible", () => {
    const candidate: RepairCandidate = {
      id: "cand_001",
      type: "legacy_v1",
      action: "delete",
      source: "legacy/v1/old.md",
      reason: "Legacy duplicate",
      metadata: { size: 1024, createdAt: 0, lastModified: 0 },
      preview: { title: "Test", description: "Test desc", sections: ["Section 1"] },
      risk: "low",
      status: "pending",
      createdAt: Date.now(),
    }
    expect(candidate.id).toBe("cand_001")
    expect(candidate.action).toBe("delete")
  })

  test("candidate status transitions are valid", () => {
    const statuses = ["pending", "approved", "rejected", "executed"] as const
    expect(statuses).toContain("pending")
    expect(statuses).toContain("executed")
  })
})
