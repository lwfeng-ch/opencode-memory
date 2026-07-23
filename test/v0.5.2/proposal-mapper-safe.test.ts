/**
 * v0.5.2 — ProposalMapper Safe Extension Tests
 * 2 tests: toSafeExecutionCandidate
 */

import { describe, it, expect } from "vitest"
import { ProposalMapper } from "../../src/dream/proposal.js"
import type { ConsolidationCandidate } from "../../src/dream/candidate/types.js"
import type { RiskAssessment } from "../../src/safe-execution/types.js"

describe("ProposalMapper safe extension", () => {
  const mapper = new ProposalMapper()

  function makeCandidate(overrides: Partial<ConsolidationCandidate> = {}): ConsolidationCandidate {
    return {
      id: "c1", clusterId: "cl1", action: "archive", targets: ["a.md"],
      evidence: { clusterId: "cl1", members: [] },
      expectedGain: 0.5, riskHint: 0.1, confidence: 0.85,
      ...overrides,
    }
  }

  function makeRisk(): RiskAssessment {
    return {
      score: 0.15, impact: 0.4, confidence: 0.85, blastRadius: 1,
      reversibility: "easy", factEvidence: { hasDirectUserInput: false, totalSessions: 1 },
      autoExecutable: true, label: "low",
    }
  }

  it("1. toSafeExecutionCandidate adds risk assessment", () => {
    const result = mapper.toRepairCandidate(makeCandidate())
    expect(result).not.toBeNull()
    expect(result!.risk).toBe("low")
  })

  it("2. toRepairCandidates batch works", () => {
    const results = mapper.toRepairCandidates([
      makeCandidate({ action: "archive" }),
      makeCandidate({ action: "keep" }),
    ])
    expect(results).toHaveLength(1)
  })
})