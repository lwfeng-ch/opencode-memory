/**
 * Tests for v0.4.2 Phase C2 — ProposalGenerator
 */

import { describe, it, expect } from "vitest"
import { ProposalGenerator, proposalToFinding } from "../../src/conflict/resolver.js"
import type { ConflictEdge } from "../../src/conflict/types.js"

const generator = new ProposalGenerator()

function makeEdge(overrides: Partial<ConflictEdge> = {}): ConflictEdge {
  return {
    id: "edge_1",
    source: "a.md",
    target: "b.md",
    type: "contradiction",
    claimKey: "user:uses",
    confidence: 0.75,
    ...overrides,
  }
}

describe("ProposalGenerator", () => {
  it("duplicate → keep_a proposal", () => {
    const edge = makeEdge({ type: "duplicate" })
    const proposal = generator.generate(edge, {
      worthinessA: 0.9,
      worthinessB: 0.5,
    })
    expect(proposal.recommendation).toBe("keep_a")
    expect(proposal.confidence).toBe("high")
  })

  it("superseded → keep_b proposal", () => {
    const edge = makeEdge({ type: "superseded" })
    const proposal = generator.generate(edge, {})
    expect(proposal.recommendation).toBe("keep_b")
    expect(proposal.confidence).toBe("high")
  })

  it("contradiction with user override → keep user", () => {
    const edge = makeEdge({ type: "contradiction" })
    const proposal = generator.generate(edge, {
      sourceTypeA: "user",
      sourceTypeB: "extraction",
      worthinessA: 0.8,
      worthinessB: 0.6,
    })
    expect(proposal.recommendation).toBe("keep_a")
    expect(proposal.reasoning.strongerProvenance).toBeDefined()
  })

  it("contradiction with significant worthiness gap → keep higher", () => {
    const edge = makeEdge({ type: "contradiction" })
    const proposal = generator.generate(edge, {
      worthinessA: 0.9,
      worthinessB: 0.3,
      sourceTypeA: "extraction",
      sourceTypeB: "extraction",
    })
    expect(proposal.recommendation).toBe("keep_a")
    expect(proposal.reasoning.higherWorthiness).toBeDefined()
  })

  it("contradiction without clear winner → manual_review", () => {
    const edge = makeEdge({ type: "contradiction" })
    const proposal = generator.generate(edge, {
      worthinessA: 0.6,
      worthinessB: 0.55,
      sourceTypeA: "extraction",
      sourceTypeB: "extraction",
    })
    expect(proposal.recommendation).toBe("manual_review")
  })

  it("proposal has affectedMemories set", () => {
    const edge = makeEdge({ type: "duplicate" })
    const proposal = generator.generate(edge, { worthinessA: 0.9, worthinessB: 0.5 })
    expect(proposal.affectedMemories).toContain("a.md")
    expect(proposal.affectedMemories).toContain("b.md")
  })
})

describe("proposalToFinding", () => {
  it("manual_review → null", () => {
    const proposal = {
      conflictId: "c1",
      recommendation: "manual_review" as const,
      confidence: "medium" as const,
      reasoning: {},
      affectedMemories: ["a.md"],
    }
    expect(proposalToFinding(proposal)).toBeNull()
  })

  it("keep_a → ValidationFinding", () => {
    const proposal = {
      conflictId: "c1",
      recommendation: "keep_a" as const,
      confidence: "high" as const,
      reasoning: { higherWorthiness: "better score" },
      affectedMemories: ["a.md"],
    }
    const finding = proposalToFinding(proposal)
    expect(finding).not.toBeNull()
    expect(finding!.severity).toBe("warning")
    expect(finding!.suggestedAction.type).toBe("archive")
  })
})