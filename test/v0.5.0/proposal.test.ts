/**
 * v0.5.0 Phase 5 — ProposalMapper Tests
 * 20 tests
 */

import { describe, it, expect } from "vitest"
import { ProposalMapper } from "../../src/dream/proposal.js"
import type { ConsolidationCandidate } from "../../src/dream/candidate/types.js"

function makeCandidate(overrides: Partial<ConsolidationCandidate> = {}): ConsolidationCandidate {
  return {
    id: "test-1",
    clusterId: "cluster-1",
    action: "archive",
    targets: ["b.md"],
    evidence: {
      clusterId: "cluster-1",
      members: [
        { filename: "a.md", worthiness: 0.9, confidence: 1.0, usage: 5, feedback: 0.8, temporal: 0.9, sourceType: "user" },
        { filename: "b.md", worthiness: 0.1, confidence: 0.3, usage: 0, feedback: 0, temporal: 0.3, sourceType: "extraction" },
      ],
      dominant: "a.md",
    },
    expectedGain: 0.6,
    riskHint: 0.1,
    confidence: 0.85,
    ...overrides,
  }
}

describe("ProposalMapper", () => {
  const mapper = new ProposalMapper()

  it("1. archive candidate → RepairCandidate with action: archive", () => {
    const result = mapper.toRepairCandidate(makeCandidate())
    expect(result).not.toBeNull()
    expect(result!.action).toBe("archive")
  })

  it("2. archive candidate → type: lifecycle_archive", () => {
    const result = mapper.toRepairCandidate(makeCandidate())
    expect(result!.type).toBe("lifecycle_archive")
  })

  it("3. archive candidate → source = first target", () => {
    const result = mapper.toRepairCandidate(makeCandidate({ targets: ["x.md", "y.md"] }))
    expect(result!.source).toBe("x.md")
  })

  it("4. keep candidate → null (no action)", () => {
    const result = mapper.toRepairCandidate(makeCandidate({ action: "keep" }))
    expect(result).toBeNull()
  })

  it("5. merge candidate → mapped", () => {
    const result = mapper.toRepairCandidate(makeCandidate({ action: "merge" }))
    expect(result).not.toBeNull()
    expect(result!.action).toBe("archive")
  })

  it("6. split candidate → mapped", () => {
    const result = mapper.toRepairCandidate(makeCandidate({ action: "split" }))
    expect(result).not.toBeNull()
  })

  it("7. status = pending", () => {
    const result = mapper.toRepairCandidate(makeCandidate())
    expect(result!.status).toBe("pending")
  })

  it("8. riskHint < 0.2 → risk = low", () => {
    const result = mapper.toRepairCandidate(makeCandidate({ riskHint: 0.1 }))
    expect(result!.risk).toBe("low")
  })

  it("9. riskHint 0.2-0.5 → risk = medium", () => {
    const result = mapper.toRepairCandidate(makeCandidate({ riskHint: 0.3 }))
    expect(result!.risk).toBe("medium")
  })

  it("10. riskHint >= 0.5 → risk = high", () => {
    const result = mapper.toRepairCandidate(makeCandidate({ riskHint: 0.7 }))
    expect(result!.risk).toBe("high")
  })

  it("11. reason includes dominant member", () => {
    const result = mapper.toRepairCandidate(makeCandidate())
    expect(result!.reason).toContain("dominated by a.md")
  })

  it("12. reason includes low worthiness members", () => {
    const result = mapper.toRepairCandidate(makeCandidate())
    expect(result!.reason).toContain("b.md")
  })

  it("13. preview title includes action", () => {
    const result = mapper.toRepairCandidate(makeCandidate({ action: "archive" }))
    expect(result!.preview.title).toContain("archive")
  })

  it("14. preview has confidence in sections", () => {
    const result = mapper.toRepairCandidate(makeCandidate({ confidence: 0.85 }))
    const sections = result!.preview.sections.join(" ")
    expect(sections).toContain("0.85")
  })

  it("15. toRepairCandidates batch processing", () => {
    const candidates = [
      makeCandidate({ id: "c1", action: "archive" }),
      makeCandidate({ id: "c2", action: "keep" }),
      makeCandidate({ id: "c3", action: "merge" }),
    ]
    const results = mapper.toRepairCandidates(candidates)
    expect(results).toHaveLength(2) // keep filtered out
  })

  it("16. empty input → empty output", () => {
    expect(mapper.toRepairCandidates([])).toEqual([])
  })

  it("17. no dominant → reason still generated", () => {
    const result = mapper.toRepairCandidate(makeCandidate({
      evidence: {
        clusterId: "c1",
        members: [
          { filename: "a.md", worthiness: 0.3, confidence: 0.5, usage: 0, feedback: 0, temporal: 0.5, sourceType: "unknown" },
        ],
      },
    }))
    expect(result!.reason).toBeTruthy()
  })

  it("18. createdAt is set", () => {
    const result = mapper.toRepairCandidate(makeCandidate())
    expect(result!.createdAt).toBeGreaterThan(0)
  })

  it("19. preview has description", () => {
    const result = mapper.toRepairCandidate(makeCandidate())
    expect(result!.preview.description).toContain("cluster-1")
  })

  it("20. merge candidate mapped correctly", () => {
    const result = mapper.toRepairCandidate(makeCandidate({
      action: "merge",
      targets: ["a.md", "b.md"],
    }))
    expect(result).not.toBeNull()
    expect(result!.source).toBe("a.md")
  })
})