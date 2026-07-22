/**
 * Tests for v0.4.0 Phase A — Provenance Schema Validation
 *
 * Verifies:
 * - Valid MemoryProvenance passes validation
 * - Each required field failure is correctly detected
 * - Extraction confidence bounds
 * - History constraints (non-empty, no duplicates)
 * - undefined provenance is a no-op
 */

import { describe, it, expect } from "vitest"
import {
  validateProvenance,
  isValidProvenance,
  isValidProvenanceEvent,
  type MemoryProvenance,
  type ProvenanceEvent,
} from "../../src/memory/provenance.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeValidProvenance(overrides: Partial<MemoryProvenance> = {}): MemoryProvenance {
  return {
    source: { type: "user", sessionId: "ses_1" },
    created: { timestamp: 1000, actor: "user" },
    history: [{ action: "created", timestamp: 1000, actor: "user" }],
    ...overrides,
  }
}

function makeValidEvent(overrides: Partial<ProvenanceEvent> = {}): ProvenanceEvent {
  return {
    action: "created",
    timestamp: 1000,
    actor: "user",
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Schema Validation
// ---------------------------------------------------------------------------

describe("validateProvenance", () => {
  it("should accept a valid MemoryProvenance", () => {
    const result = validateProvenance(makeValidProvenance())
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it("should accept valid provenance with extraction block", () => {
    const result = validateProvenance(
      makeValidProvenance({
        extraction: { method: "llm", confidenceScore: 0.93 },
      }),
    )
    expect(result.valid).toBe(true)
  })

  it("should accept valid provenance with transformation block (reserved)", () => {
    const result = validateProvenance(
      makeValidProvenance({
        transformation: {
          steps: [{ type: "validation", timestamp: 2000, detail: "passed" }],
        },
      }),
    )
    expect(result.valid).toBe(true)
  })

  it("should reject null/undefined", () => {
    expect(validateProvenance(null).valid).toBe(false)
    expect(validateProvenance(undefined).valid).toBe(false)
  })

  it("should reject non-object", () => {
    expect(validateProvenance("string").valid).toBe(false)
    expect(validateProvenance(42).valid).toBe(false)
  })
})

describe("validateProvenance — source", () => {
  it("should reject missing source", () => {
    const { source, ...rest } = makeValidProvenance()
    const result = validateProvenance(rest)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes("source"))).toBe(true)
  })

  it("should reject missing source.type", () => {
    const result = validateProvenance(
      makeValidProvenance({ source: { sessionId: "ses_1" } as any }),
    )
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes("source.type"))).toBe(true)
  })

  it("should reject invalid source.type", () => {
    const result = validateProvenance(
      makeValidProvenance({ source: { type: "admin" } as any }),
    )
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes("source.type"))).toBe(true)
  })
})

describe("validateProvenance — created", () => {
  it("should reject missing created", () => {
    const { created, ...rest } = makeValidProvenance()
    const result = validateProvenance(rest)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes("created"))).toBe(true)
  })

  it("should reject negative timestamp", () => {
    const result = validateProvenance(
      makeValidProvenance({ created: { timestamp: -1, actor: "user" } }),
    )
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes("timestamp"))).toBe(true)
  })

  it("should reject invalid created.actor", () => {
    const result = validateProvenance(
      makeValidProvenance({ created: { timestamp: 1000, actor: "robot" } as any }),
    )
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes("actor"))).toBe(true)
  })
})

describe("validateProvenance — extraction confidence", () => {
  it("should reject confidenceScore > 1", () => {
    const result = validateProvenance(
      makeValidProvenance({
        extraction: { method: "llm", confidenceScore: 1.5 },
      }),
    )
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes("confidenceScore"))).toBe(true)
  })

  it("should reject confidenceScore < 0", () => {
    const result = validateProvenance(
      makeValidProvenance({
        extraction: { method: "llm", confidenceScore: -0.1 },
      }),
    )
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes("confidenceScore"))).toBe(true)
  })

  it("should accept confidenceScore = 0 (valid lower bound)", () => {
    const result = validateProvenance(
      makeValidProvenance({
        extraction: { method: "llm", confidenceScore: 0 },
      }),
    )
    expect(result.valid).toBe(true)
  })

  it("should accept confidenceScore = 1 (valid upper bound)", () => {
    const result = validateProvenance(
      makeValidProvenance({
        extraction: { method: "llm", confidenceScore: 1 },
      }),
    )
    expect(result.valid).toBe(true)
  })
})

describe("validateProvenance — history", () => {
  it("should reject empty history", () => {
    const result = validateProvenance(
      makeValidProvenance({ history: [] }),
    )
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes("history"))).toBe(true)
  })

  it("should reject exact duplicate action+timestamp", () => {
    const result = validateProvenance(
      makeValidProvenance({
        history: [
          { action: "created", timestamp: 1000, actor: "user" },
          { action: "created", timestamp: 1000, actor: "user" }, // exact duplicate
        ],
      }),
    )
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes("duplicate"))).toBe(true)
  })

  it("should accept different timestamps for same action", () => {
    const result = validateProvenance(
      makeValidProvenance({
        history: [
          { action: "created", timestamp: 1000, actor: "user" },
          { action: "created", timestamp: 1100, actor: "user" }, // different timestamp
        ],
      }),
    )
    expect(result.valid).toBe(true)
  })

  it("should accept different actions at same timestamp", () => {
    const result = validateProvenance(
      makeValidProvenance({
        history: [
          { action: "created", timestamp: 1000, actor: "user" },
          { action: "updated", timestamp: 1000, actor: "user" },
        ],
      }),
    )
    // Different actions, same second — not a duplicate
    expect(result.valid).toBe(true)
  })
})

describe("isValidProvenance", () => {
  it("should return true for valid provenance", () => {
    expect(isValidProvenance(makeValidProvenance())).toBe(true)
  })

  it("should return false for invalid provenance", () => {
    expect(isValidProvenance({})).toBe(false)
  })
})

describe("isValidProvenanceEvent", () => {
  it("should return true for valid event", () => {
    expect(isValidProvenanceEvent(makeValidEvent())).toBe(true)
  })

  it("should return true for archived event", () => {
    expect(isValidProvenanceEvent(makeValidEvent({ action: "archived", actor: "repair" }))).toBe(true)
  })

  it("should return false for invalid event", () => {
    expect(isValidProvenanceEvent({})).toBe(false)
  })

  it("should return false for null", () => {
    expect(isValidProvenanceEvent(null)).toBe(false)
  })
})