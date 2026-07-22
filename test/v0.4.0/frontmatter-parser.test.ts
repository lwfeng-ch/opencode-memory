/**
 * Tests for v0.4.0 Phase A — Frontmatter Provenance Parser
 *
 * Verifies:
 * - Parse full provenance from frontmatter JSON string
 * - Parse minimal provenance
 * - Frontmatter without provenance → undefined
 * - Frontmatter with invalid provenance → undefined (graceful)
 * - Partial provenance → graceful fallback
 * - Round-trip serialize → parse → match
 * - Serialize with undefined provenance → no key
 * - Extra unknown fields in provenance are tolerated
 */

import { describe, it, expect } from "vitest"
import {
  serializeProvenance,
  parseProvenance,
  createProvenance,
  type MemoryProvenance,
} from "../../src/memory/provenance.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFullProvenance(): MemoryProvenance {
  return {
    source: { type: "user", sessionId: "ses_abc123" },
    created: {
      timestamp: 1784684058903,
      actor: "user",
      model: "deepseek-v4-flash",
      extractorVersion: "0.4.0",
    },
    extraction: {
      method: "explicit",
      confidenceScore: 1.0,
    },
    history: [
      { action: "created", timestamp: 1784684058903, actor: "user" },
    ],
  }
}

// ---------------------------------------------------------------------------
// parseProvenance
// ---------------------------------------------------------------------------

describe("parseProvenance", () => {
  it("should parse full provenance from JSON string", () => {
    const json = JSON.stringify(makeFullProvenance())
    const result = parseProvenance(json)
    expect(result).toBeDefined()
    expect(result!.source.type).toBe("user")
    expect(result!.source.sessionId).toBe("ses_abc123")
    expect(result!.created.timestamp).toBe(1784684058903)
    expect(result!.created.actor).toBe("user")
    expect(result!.created.model).toBe("deepseek-v4-flash")
    expect(result!.extraction?.method).toBe("explicit")
    expect(result!.extraction?.confidenceScore).toBe(1.0)
    expect(result!.history).toHaveLength(1)
    expect(result!.history[0].action).toBe("created")
  })

  it("should parse minimal provenance (only required fields)", () => {
    const minimal: MemoryProvenance = {
      source: { type: "session" },
      created: { timestamp: 2000, actor: "system" },
      history: [{ action: "created", timestamp: 2000, actor: "system" }],
    }
    const json = JSON.stringify(minimal)
    const result = parseProvenance(json)
    expect(result).toBeDefined()
    expect(result!.source.type).toBe("session")
    expect(result!.created.timestamp).toBe(2000)
    expect(result!.extraction).toBeUndefined()
    expect(result!.history).toHaveLength(1)
  })

  it("should return undefined when frontmatter has no provenance key", () => {
    const result = parseProvenance(undefined)
    expect(result).toBeUndefined()
  })

  it("should return undefined when provenance is null", () => {
    const result = parseProvenance(null)
    expect(result).toBeUndefined()
  })

  it("should return undefined when provenance is empty string", () => {
    const result = parseProvenance("")
    expect(result).toBeUndefined()
  })

  it("should return undefined when provenance JSON is invalid", () => {
    const result = parseProvenance("not-json")
    expect(result).toBeUndefined()
  })

  it("should return undefined when provenance object is structurally invalid", () => {
    const result = parseProvenance(JSON.stringify({ invalid: true }))
    expect(result).toBeUndefined()
  })

  it("should tolerate extra unknown fields in provenance", () => {
    const withExtra = {
      ...makeFullProvenance(),
      extraField: "should be tolerated",
      nestedExtra: { foo: "bar" },
    }
    const json = JSON.stringify(withExtra)
    // JSON.parse doesn't validate — but parseProvenance should still pass
    // the valid parts through since JSON.parse produces a valid object
    // and validateProvenance only checks known fields
    const result = parseProvenance(json)
    expect(result).toBeDefined()
    expect(result!.source.type).toBe("user")
  })
})

// ---------------------------------------------------------------------------
// serializeProvenance
// ---------------------------------------------------------------------------

describe("serializeProvenance", () => {
  it("should serialize provenance to compact JSON string", () => {
    const prov = makeFullProvenance()
    const json = serializeProvenance(prov)
    expect(json).toBeDefined()
    expect(typeof json).toBe("string")
    // Verify it round-trips
    const parsed = JSON.parse(json!)
    expect(parsed.source.type).toBe("user")
  })

  it("should return undefined when provenance is undefined", () => {
    expect(serializeProvenance(undefined)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Round-trip: serialize → parse
// ---------------------------------------------------------------------------

describe("serialize → parse round-trip", () => {
  it("should produce exact match after round-trip", () => {
    const original = makeFullProvenance()
    const json = serializeProvenance(original)!
    const parsed = parseProvenance(json)!
    expect(parsed.source.type).toBe(original.source.type)
    expect(parsed.source.sessionId).toBe(original.source.sessionId)
    expect(parsed.created.timestamp).toBe(original.created.timestamp)
    expect(parsed.created.actor).toBe(original.created.actor)
    expect(parsed.extraction?.method).toBe(original.extraction?.method)
    expect(parsed.extraction?.confidenceScore).toBe(original.extraction?.confidenceScore)
    expect(parsed.history).toHaveLength(original.history.length)
    expect(parsed.history[0].action).toBe(original.history[0].action)
  })

  it("should round-trip with extraction block", () => {
    const prov = makeFullProvenance()
    prov.extraction = { method: "llm", confidenceScore: 0.73 }
    const json = serializeProvenance(prov)!
    const parsed = parseProvenance(json)!
    expect(parsed.extraction?.method).toBe("llm")
    expect(parsed.extraction?.confidenceScore).toBe(0.73)
  })

  it("should round-trip with history array", () => {
    const prov = makeFullProvenance()
    prov.history = [
      { action: "created", timestamp: 1000, actor: "user" },
      { action: "updated", timestamp: 2000, actor: "system" },
      { action: "archived", timestamp: 3000, actor: "repair" },
    ]
    const json = serializeProvenance(prov)!
    const parsed = parseProvenance(json)!
    expect(parsed.history).toHaveLength(3)
    expect(parsed.history[0].action).toBe("created")
    expect(parsed.history[1].action).toBe("updated")
    expect(parsed.history[2].action).toBe("archived")
  })
})

// ---------------------------------------------------------------------------
// createProvenance
// ---------------------------------------------------------------------------

describe("createProvenance", () => {
  it("should create provenance with user source", () => {
    const prov = createProvenance(
      { type: "user", sessionId: "ses_1" },
      "user",
      { method: "explicit", confidenceScore: 1.0 },
    )
    expect(prov.source.type).toBe("user")
    expect(prov.source.sessionId).toBe("ses_1")
    expect(prov.created.actor).toBe("user")
    expect(prov.created.timestamp).toBeGreaterThan(0)
    expect(prov.extraction?.method).toBe("explicit")
    expect(prov.extraction?.confidenceScore).toBe(1.0)
    expect(prov.history).toHaveLength(1)
    expect(prov.history[0].action).toBe("created")
  })

  it("should create provenance without extraction block", () => {
    const prov = createProvenance(
      { type: "migration" },
      "migration",
    )
    expect(prov.source.type).toBe("migration")
    expect(prov.extraction).toBeUndefined()
    expect(prov.history).toHaveLength(1)
  })
})