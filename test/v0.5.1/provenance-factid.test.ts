/**
 * v0.5.1 — Provenance factId Tests
 * 4 tests: write/read/backward-compat/missing
 */

import { describe, it, expect } from "vitest"
import { createProvenance, serializeProvenance, parseProvenance, isValidProvenance } from "../../src/memory/provenance.js"

describe("Provenance factId", () => {
  it("1. create provenance with factId", () => {
    const prov = createProvenance(
      { type: "extraction", sessionId: "ses_abc", factId: "memory://fact-session/ses_abc" },
      "extraction",
      { method: "llm", confidenceScore: 0.8 },
    )
    expect(prov.source.factId).toBe("memory://fact-session/ses_abc")
    expect(prov.source.sessionId).toBe("ses_abc")
  })

  it("2. serialize and parse provenance with factId", () => {
    const prov = createProvenance(
      { type: "extraction", sessionId: "ses_abc", factId: "memory://fact-session/ses_abc" },
      "extraction",
    )
    const serialized = serializeProvenance(prov)
    expect(serialized).toBeDefined()

    const parsed = parseProvenance(serialized)
    expect(parsed).toBeDefined()
    expect(parsed!.source.factId).toBe("memory://fact-session/ses_abc")
  })

  it("3. backward compatible — no factId", () => {
    const prov = createProvenance(
      { type: "user", sessionId: "ses_abc" },
      "user",
    )
    expect(prov.source.factId).toBeUndefined()
    const serialized = serializeProvenance(prov)
    const parsed = parseProvenance(serialized)
    expect(parsed!.source.factId).toBeUndefined()
  })

  it("4. missing factId → isValidProvenance still true", () => {
    const prov = createProvenance(
      { type: "extraction", sessionId: "ses_abc" },
      "extraction",
    )
    expect(isValidProvenance(prov)).toBe(true)
  })
})