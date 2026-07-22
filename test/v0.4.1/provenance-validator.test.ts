/**
 * Tests for v0.4.1 Phase B2 — ProvenanceValidator
 */

import { describe, it, expect } from "vitest"
import {
  evaluateSourceTrust,
  evaluateExtractionConfidence,
  evaluateHistoryIntegrity,
  calibrateClaimConfidence,
  computeProvenanceConfidence,
  type ProvenanceConfidenceInput,
} from "../../src/validation/dimensions/provenance.js"
import type { MemoryProvenance } from "../../src/memory/provenance.js"

describe("evaluateSourceTrust", () => {
  it("user → 1.0", () => expect(evaluateSourceTrust("user")).toBe(1.0))
  it("feedback → 1.0", () => expect(evaluateSourceTrust("feedback")).toBe(1.0))
  it("extraction → 0.8", () => expect(evaluateSourceTrust("extraction")).toBe(0.8))
  it("session → 0.6", () => expect(evaluateSourceTrust("session")).toBe(0.6))
  it("migration → 0.4", () => expect(evaluateSourceTrust("migration")).toBe(0.4))
})

describe("evaluateExtractionConfidence", () => {
  it("explicit with confidenceScore → direct", () => {
    expect(evaluateExtractionConfidence({ method: "explicit", confidenceScore: 0.95 })).toBe(0.95)
  })

  it("llm with high confidenceScore → direct", () => {
    expect(evaluateExtractionConfidence({ method: "llm", confidenceScore: 0.9 })).toBe(0.9)
  })

  it("llm with medium confidenceScore → ×0.9", () => {
    expect(evaluateExtractionConfidence({ method: "llm", confidenceScore: 0.6 })).toBeCloseTo(0.54, 2)
  })

  it("llm with low confidenceScore → ×0.7", () => {
    expect(evaluateExtractionConfidence({ method: "llm", confidenceScore: 0.3 })).toBeCloseTo(0.21, 2)
  })

  it("dream → ×0.8", () => {
    expect(evaluateExtractionConfidence({ method: "dream", confidenceScore: 0.8 })).toBeCloseTo(0.64, 2)
  })

  it("no extraction → 0.5 (default)", () => {
    expect(evaluateExtractionConfidence(undefined)).toBe(0.5)
  })
})

describe("evaluateHistoryIntegrity", () => {
  it("valid history with created event → score 1.0", () => {
    const result = evaluateHistoryIntegrity([
      { action: "created", timestamp: 1000, actor: "user" },
    ])
    expect(result.score).toBe(1.0)
    expect(result.issues).toHaveLength(0)
  })

  it("missing created event → penalized", () => {
    const result = evaluateHistoryIntegrity([
      { action: "updated", timestamp: 2000, actor: "system" },
    ])
    expect(result.score).toBeLessThan(1.0)
    expect(result.issues).toContain("missing created event")
  })

  it("empty history → score 0", () => {
    const result = evaluateHistoryIntegrity([])
    expect(result.score).toBe(0)
  })

  it("timestamp going backward → penalized", () => {
    const result = evaluateHistoryIntegrity([
      { action: "created", timestamp: 2000, actor: "user" },
      { action: "updated", timestamp: 1000, actor: "system" },
    ])
    expect(result.score).toBeLessThan(1.0)
    expect(result.issues.some((i) => i.startsWith("timestamp went backward"))).toBe(true)
  })
})

describe("calibrateClaimConfidence", () => {
  it("explicit with high extraction confidence → 1.0", () => {
    const result = calibrateClaimConfidence("explicit", 0.9)
    expect(result.score).toBe(1.0)
  })

  it("explicit with low extraction confidence → warning", () => {
    const result = calibrateClaimConfidence("explicit", 0.2)
    expect(result.score).toBeLessThan(1.0)
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it("inferred → 0.6", () => {
    expect(calibrateClaimConfidence("inferred").score).toBe(0.6)
  })

  it("uncertain → 0.3", () => {
    expect(calibrateClaimConfidence("uncertain").score).toBe(0.3)
  })
})

describe("computeProvenanceConfidence", () => {
  it("user provenance with explicit confidence → high score", () => {
    const input: ProvenanceConfidenceInput = {
      provenance: {
        source: { type: "user", sessionId: "ses_1" },
        created: { timestamp: 1000, actor: "user" },
        extraction: { method: "explicit", confidenceScore: 1.0 },
        history: [{ action: "created", timestamp: 1000, actor: "user" }],
      },
      confidence: "explicit",
    }
    const result = computeProvenanceConfidence(input)
    expect(result.score).toBeGreaterThanOrEqual(0.85)
    expect(result.hasSource).toBe(true)
    expect(result.hasExtraction).toBe(true)
    expect(result.sourceType).toBe("user")
  })

  it("migration provenance → medium score (no extraction info)", () => {
    // sourceTrust=0.4, extractionConf=0.5 (default), historyIntegrity=1.0, claim=0.6 (inferred)
    // weighted: 0.12+0.125+0.20+0.15=0.595
    const input: ProvenanceConfidenceInput = {
      provenance: {
        source: { type: "migration" },
        created: { timestamp: 1000, actor: "migration" },
        history: [{ action: "created", timestamp: 1000, actor: "migration" }],
      },
      confidence: "inferred",
    }
    const result = computeProvenanceConfidence(input)
    expect(result.score).toBeGreaterThanOrEqual(0.5)
    expect(result.score).toBeLessThan(0.7)
  })

  it("missing provenance → score 0.2", () => {
    const result = computeProvenanceConfidence({ provenance: undefined, confidence: "inferred" })
    expect(result.score).toBe(0.2)
    expect(result.hasSource).toBe(false)
    expect(result.hasExtraction).toBe(false)
  })
})