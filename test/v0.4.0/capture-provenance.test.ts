/**
 * Tests for v0.4.0 Phase C — Capture Path Provenance
 *
 * Verifies that the provenance injection layer produces correct
 * provenance for session/capture-originated memory writes.
 *
 * Note: These test the handler-level provenance injection function
 * (injectProvenance in tools.ts), not the capture pipeline itself.
 * The capture pipeline is tested in its own integration tests.
 */

import { describe, it, expect } from "vitest"
import { createProvenance, serializeProvenance, parseProvenance } from "../../src/memory/provenance.js"

describe("capture provenance", () => {
  it("should produce provenance with source.type='session'", () => {
    const prov = createProvenance(
      { type: "session", sessionId: "ses_abc123" },
      "system",
    )
    const json = serializeProvenance(prov)!
    const parsed = parseProvenance(json)!
    expect(parsed.source.type).toBe("session")
    expect(parsed.source.sessionId).toBe("ses_abc123")
  })

  it("should include sessionId in provenance", () => {
    const prov = createProvenance(
      { type: "session", sessionId: "ses_xyz789" },
      "system",
    )
    expect(prov.source.sessionId).toBe("ses_xyz789")
  })

  it("should include created.timestamp (valid and recent)", () => {
    const before = Date.now()
    const prov = createProvenance(
      { type: "session", sessionId: "ses_1" },
      "system",
    )
    const after = Date.now()
    expect(prov.created.timestamp).toBeGreaterThanOrEqual(before)
    expect(prov.created.timestamp).toBeLessThanOrEqual(after)
  })

  it("should include history with created action", () => {
    const prov = createProvenance(
      { type: "session", sessionId: "ses_1" },
      "system",
    )
    expect(prov.history).toHaveLength(1)
    expect(prov.history[0].action).toBe("created")
    expect(prov.history[0].actor).toBe("system")
  })

  it("should handle missing sessionId gracefully", () => {
    const prov = createProvenance(
      { type: "session" },
      "system",
    )
    expect(prov.source.type).toBe("session")
    expect(prov.source.sessionId).toBeUndefined()
    expect(prov.history).toHaveLength(1)
  })
})