/**
 * Tests for v0.4.0 Phase D — Promotion Merge Provenance
 *
 * Verifies the mergeProvenance function:
 * - merge: explicit + inferred → explicit (max rank)
 * - merge: inferred + explicit → explicit (max rank)
 * - merge: uncertain + inferred → inferred (max rank)
 * - merge: confidenceScore not modified (original values preserved)
 * - merge: source takes higher rank (user > session)
 * - merge: history includes both sources
 * - merge: merged event appended
 * - merge: detail field describes sources
 */

import { describe, it, expect } from "vitest"
import {
  mergeProvenance,
  mergeConfidence,
  mergeSourceType,
  type MemoryProvenance,
} from "../../src/memory/provenance.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProvenance(overrides: Partial<MemoryProvenance> = {}): MemoryProvenance {
  return {
    source: { type: "user", sessionId: "ses_1" },
    created: { timestamp: 1000, actor: "user" },
    history: [{ action: "created", timestamp: 1000, actor: "user" }],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// mergeConfidence
// ---------------------------------------------------------------------------

describe("mergeConfidence", () => {
  it("should return explicit when merging explicit + inferred", () => {
    expect(mergeConfidence("explicit", "inferred")).toBe("explicit")
  })

  it("should return explicit when merging inferred + explicit", () => {
    expect(mergeConfidence("inferred", "explicit")).toBe("explicit")
  })

  it("should return inferred when merging uncertain + inferred", () => {
    expect(mergeConfidence("uncertain", "inferred")).toBe("inferred")
  })

  it("should return explicit when merging explicit + explicit", () => {
    expect(mergeConfidence("explicit", "explicit")).toBe("explicit")
  })
})

// ---------------------------------------------------------------------------
// mergeSourceType
// ---------------------------------------------------------------------------

describe("mergeSourceType", () => {
  it("should return user when merging user + session", () => {
    expect(mergeSourceType("user", "session")).toBe("user")
  })

  it("should return user when merging session + user", () => {
    expect(mergeSourceType("session", "user")).toBe("user")
  })

  it("should return extraction when merging extraction + session", () => {
    expect(mergeSourceType("extraction", "session")).toBe("extraction")
  })

  it("should return migration when merging migration + migration", () => {
    expect(mergeSourceType("migration", "migration")).toBe("migration")
  })
})

// ---------------------------------------------------------------------------
// mergeProvenance
// ---------------------------------------------------------------------------

describe("mergeProvenance", () => {
  it("should not modify extraction confidenceScore (original values preserved)", () => {
    const A = makeProvenance({
      source: { type: "user", sessionId: "ses_1" },
      extraction: { method: "explicit", confidenceScore: 0.99 },
    })
    const B = makeProvenance({
      source: { type: "session", sessionId: "ses_2" },
      extraction: { method: "llm", confidenceScore: 0.73 },
    })

    const result = mergeProvenance(A, B)
    // The extraction from the higher-ranked source (user) is kept
    expect(result.provenance.extraction?.confidenceScore).toBe(0.99)
    expect(result.provenance.extraction?.method).toBe("explicit")
  })

  it("should take source from higher rank (user > session)", () => {
    const A = makeProvenance({
      source: { type: "user", sessionId: "ses_1" },
    })
    const B = makeProvenance({
      source: { type: "session", sessionId: "ses_2" },
    })

    const result = mergeProvenance(A, B)
    expect(result.provenance.source.type).toBe("user")
  })

  it("should include history from both sources", () => {
    const A = makeProvenance({
      source: { type: "user", sessionId: "ses_1" },
      history: [{ action: "created", timestamp: 1000, actor: "user" }],
    })
    const B = makeProvenance({
      source: { type: "session", sessionId: "ses_2" },
      history: [{ action: "created", timestamp: 2000, actor: "system" }],
    })

    const result = mergeProvenance(A, B)
    // Both history events should be present
    const actions = result.provenance.history.map((e) => e.action)
    expect(actions.filter((a) => a === "created")).toHaveLength(2)
  })

  it("should append merged event as the last history entry", () => {
    const A = makeProvenance({ source: { type: "user", sessionId: "ses_1" } })
    const B = makeProvenance({ source: { type: "session", sessionId: "ses_2" } })

    const result = mergeProvenance(A, B)
    const lastEvent = result.provenance.history[result.provenance.history.length - 1]
    expect(lastEvent.action).toBe("merged")
    expect(lastEvent.actor).toBe("system")
  })

  it("should include detail field describing merged sources", () => {
    const A = makeProvenance({ source: { type: "user", sessionId: "ses_1" } })
    const B = makeProvenance({ source: { type: "session", sessionId: "ses_2" } })

    const result = mergeProvenance(A, B)
    const lastEvent = result.provenance.history[result.provenance.history.length - 1]
    expect(lastEvent.detail).toBeDefined()
    expect(lastEvent.detail).toContain("user")
    expect(lastEvent.detail).toContain("session")
  })

  it("should preserve original creation timestamp from source A", () => {
    const A = makeProvenance({
      source: { type: "user", sessionId: "ses_1" },
      created: { timestamp: 1000, actor: "user" },
    })
    const B = makeProvenance({
      source: { type: "session", sessionId: "ses_2" },
      created: { timestamp: 2000, actor: "system" },
    })

    const result = mergeProvenance(A, B)
    // created should come from the higher-ranked source (A = user)
    expect(result.provenance.created.timestamp).toBe(1000)
  })
})