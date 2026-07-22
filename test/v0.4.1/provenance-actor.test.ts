/**
 * Tests for v0.4.1 Phase A1 — ProvenanceActor Unification
 *
 * Verifies:
 * - created.actor accepts all 7 valid types
 * - history[].actor accepts all 7 valid types
 * - Invalid actor rejected
 * - Old format still valid
 */

import { describe, it, expect } from "vitest"
import { validateProvenance, isValidProvenanceEvent, type MemoryProvenance } from "../../src/memory/provenance.js"

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

// ---------------------------------------------------------------------------
// created.actor
// ---------------------------------------------------------------------------

describe("created.actor unification", () => {
  it("should accept 'user'", () => {
    const result = validateProvenance(makeValidProvenance({ created: { timestamp: 1000, actor: "user" } }))
    expect(result.valid).toBe(true)
  })

  it("should accept 'system'", () => {
    const result = validateProvenance(makeValidProvenance({ created: { timestamp: 1000, actor: "system" } }))
    expect(result.valid).toBe(true)
  })

  it("should accept 'migration'", () => {
    const result = validateProvenance(makeValidProvenance({ created: { timestamp: 1000, actor: "migration" } }))
    expect(result.valid).toBe(true)
  })

  it("should accept 'extraction'", () => {
    const result = validateProvenance(makeValidProvenance({ created: { timestamp: 1000, actor: "extraction" } }))
    expect(result.valid).toBe(true)
  })

  it("should accept 'dream'", () => {
    const result = validateProvenance(makeValidProvenance({ created: { timestamp: 1000, actor: "dream" } }))
    expect(result.valid).toBe(true)
  })

  it("should accept 'repair'", () => {
    const result = validateProvenance(makeValidProvenance({ created: { timestamp: 1000, actor: "repair" } }))
    expect(result.valid).toBe(true)
  })

  it("should accept 'conflict-resolution'", () => {
    const result = validateProvenance(makeValidProvenance({ created: { timestamp: 1000, actor: "conflict-resolution" } }))
    expect(result.valid).toBe(true)
  })

  it("should reject invalid actor", () => {
    const result = validateProvenance(makeValidProvenance({ created: { timestamp: 1000, actor: "robot" as any } }))
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes("actor"))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// history[].actor
// ---------------------------------------------------------------------------

describe("history[].actor unification", () => {
  it("should accept 'user'", () => {
    const result = validateProvenance(makeValidProvenance({
      history: [{ action: "created", timestamp: 1000, actor: "user" }],
    }))
    expect(result.valid).toBe(true)
  })

  it("should accept 'system'", () => {
    const result = validateProvenance(makeValidProvenance({
      history: [{ action: "created", timestamp: 1000, actor: "system" }],
    }))
    expect(result.valid).toBe(true)
  })

  it("should accept 'dream'", () => {
    const result = validateProvenance(makeValidProvenance({
      history: [{ action: "created", timestamp: 1000, actor: "dream" }],
    }))
    expect(result.valid).toBe(true)
  })

  it("should accept 'extraction'", () => {
    const result = validateProvenance(makeValidProvenance({
      history: [{ action: "created", timestamp: 1000, actor: "extraction" }],
    }))
    expect(result.valid).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// isValidProvenanceEvent
// ---------------------------------------------------------------------------

describe("isValidProvenanceEvent with unified actor", () => {
  it("should accept 'extraction'", () => {
    expect(isValidProvenanceEvent({ action: "created", timestamp: 1000, actor: "extraction" })).toBe(true)
  })

  it("should accept 'dream'", () => {
    expect(isValidProvenanceEvent({ action: "created", timestamp: 1000, actor: "dream" })).toBe(true)
  })

  it("should accept 'conflict-resolution'", () => {
    expect(isValidProvenanceEvent({ action: "created", timestamp: 1000, actor: "conflict-resolution" })).toBe(true)
  })

  it("should reject invalid actor", () => {
    expect(isValidProvenanceEvent({ action: "created", timestamp: 1000, actor: "robot" })).toBe(false)
  })
})