/**
 * Tests for v0.4.2 Phase A1 — Conflict Types
 */

import { describe, it, expect } from "vitest"
import {
  determineSeverity,
  generateClaimId,
  generateConflictId,
  formatClaimKey,
  CANDIDATE_MIN_SIMILARITY,
  DUPLICATE_MIN_SIMILARITY,
  CONTRADICTION_MIN_TOPIC_SIMILARITY,
  SUPERSEDED_TIMESTAMP_THRESHOLD_MS,
  type ConflictType,
  type MemoryClaim,
  type ConflictGraph,
  type ConflictResolutionProposal,
  type ProposalAction,
} from "../../src/conflict/types.js"

describe("ConflictType", () => {
  it("should have three values: contradiction, superseded, duplicate", () => {
    const types: ConflictType[] = ["contradiction", "superseded", "duplicate"]
    expect(types).toHaveLength(3)
  })
})

describe("MemoryClaim", () => {
  it("should construct correctly", () => {
    const claim: MemoryClaim = {
      id: "claim_1",
      subject: "user",
      predicate: "uses",
      value: "bun",
      sourceMemory: "test.md",
    }
    expect(claim.subject).toBe("user")
    expect(claim.predicate).toBe("uses")
    expect(claim.value).toBe("bun")
    expect(claim.sourceMemory).toBe("test.md")
  })
})

describe("ConflictGraph", () => {
  it("should construct with nodes, edges, components", () => {
    const graph: ConflictGraph = {
      nodes: [],
      edges: [],
      components: [],
    }
    expect(graph.nodes).toHaveLength(0)
    expect(graph.edges).toHaveLength(0)
    expect(graph.components).toHaveLength(0)
  })
})

describe("ConflictResolutionProposal", () => {
  it("should not have approvedAt by default", () => {
    const proposal: ConflictResolutionProposal = {
      conflictId: "c1",
      recommendation: "keep_a",
      confidence: "high",
      reasoning: {},
      affectedMemories: ["a.md"],
    }
    expect(proposal.approvedAt).toBeUndefined()
    expect(proposal.approvedBy).toBeUndefined()
  })
})

describe("determineSeverity", () => {
  it("contradiction with active ≥ 2 → critical", () => {
    expect(determineSeverity("contradiction", 2)).toBe("critical")
    expect(determineSeverity("contradiction", 3)).toBe("critical")
  })

  it("contradiction with active < 2 → warning", () => {
    expect(determineSeverity("contradiction", 1)).toBe("warning")
  })

  it("superseded → warning", () => {
    expect(determineSeverity("superseded", 2)).toBe("warning")
    expect(determineSeverity("superseded", 1)).toBe("warning")
  })

  it("duplicate → info", () => {
    expect(determineSeverity("duplicate", 2)).toBe("info")
  })
})

describe("generateClaimId", () => {
  it("should return unique ids", () => {
    const id1 = generateClaimId()
    const id2 = generateClaimId()
    expect(id1).not.toBe(id2)
  })
})

describe("formatClaimKey", () => {
  it("should format as subject:predicate", () => {
    expect(formatClaimKey("user", "uses")).toBe("user:uses")
  })
})

describe("Constants", () => {
  it("CANDIDATE_MIN_SIMILARITY is 0.6", () => {
    expect(CANDIDATE_MIN_SIMILARITY).toBe(0.6)
  })

  it("DUPLICATE_MIN_SIMILARITY is 0.95", () => {
    expect(DUPLICATE_MIN_SIMILARITY).toBe(0.95)
  })

  it("SUPERSEDED_TIMESTAMP_THRESHOLD_MS is 7 days", () => {
    expect(SUPERSEDED_TIMESTAMP_THRESHOLD_MS).toBe(7 * 24 * 60 * 60 * 1000)
  })
})