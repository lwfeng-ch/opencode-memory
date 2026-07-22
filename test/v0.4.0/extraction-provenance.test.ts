/**
 * Tests for v0.4.0 Phase C — Extraction Provenance
 *
 * Verifies that the provenance injection layer produces correct
 * provenance for extraction-originated memory writes.
 *
 * These test the handler-level injectProvenance function with
 * extraction overrides, not the extraction pipeline itself.
 */

import { describe, it, expect } from "vitest"
import { createProvenance, serializeProvenance, parseProvenance } from "../../src/memory/provenance.js"

describe("extraction provenance", () => {
  it("should produce provenance with source.type='extraction'", () => {
    const prov = createProvenance(
      { type: "extraction", sessionId: "ses_extract_1" },
      "system",
      { method: "llm", confidenceScore: 0.93 },
    )
    const json = serializeProvenance(prov)!
    const parsed = parseProvenance(json)!
    expect(parsed.source.type).toBe("extraction")
    expect(parsed.source.sessionId).toBe("ses_extract_1")
  })

  it("should include extraction confidenceScore in 0-1 range", () => {
    const prov = createProvenance(
      { type: "extraction", sessionId: "ses_1" },
      "system",
      { method: "llm", confidenceScore: 0.73 },
    )
    expect(prov.extraction).toBeDefined()
    expect(prov.extraction!.confidenceScore).toBeGreaterThanOrEqual(0)
    expect(prov.extraction!.confidenceScore).toBeLessThanOrEqual(1)
    expect(prov.extraction!.confidenceScore).toBe(0.73)
  })

  it("should set extraction method to 'llm' for LLM extraction", () => {
    const prov = createProvenance(
      { type: "extraction", sessionId: "ses_1" },
      "system",
      { method: "llm", confidenceScore: 0.85 },
    )
    expect(prov.extraction?.method).toBe("llm")
  })

  it("should set extraction method to 'explicit' for explicit feedback", () => {
    const prov = createProvenance(
      { type: "extraction", sessionId: "ses_1" },
      "system",
      { method: "explicit", confidenceScore: 1.0 },
    )
    expect(prov.extraction?.method).toBe("explicit")
  })

  it("should handle extraction without override gracefully", () => {
    // When no extraction block is provided, extraction should not be set
    const prov = createProvenance(
      { type: "extraction", sessionId: "ses_1" },
      "system",
    )
    expect(prov.extraction).toBeUndefined()
    expect(prov.source.type).toBe("extraction")
    expect(prov.history).toHaveLength(1)
  })
})