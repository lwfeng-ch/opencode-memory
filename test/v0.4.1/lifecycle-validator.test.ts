/**
 * Tests for v0.4.1 Phase B3 — LifecycleValidator
 */

import { describe, it, expect } from "vitest"
import {
  evaluateStatusAppropriateness,
  evaluateStability,
  computeLifecycleValidity,
  type LifecycleValidityInput,
} from "../../src/validation/dimensions/lifecycle.js"
import type { ProvenanceEvent } from "../../src/memory/provenance.js"

const DAY_MS = 24 * 60 * 60 * 1000

describe("evaluateStatusAppropriateness", () => {
  it("active, recently recalled → 1.0", () => {
    const result = evaluateStatusAppropriateness({
      status: "active",
      recallCount: 5,
      lastRecalledAt: new Date(Date.now() - DAY_MS).toISOString(),
      archivedAt: null,
    })
    expect(result).toBe(1.0)
  })

  it("active, old recall (30-180d) → 0.8", () => {
    const result = evaluateStatusAppropriateness({
      status: "active",
      recallCount: 2,
      lastRecalledAt: new Date(Date.now() - 60 * DAY_MS).toISOString(),
      archivedAt: null,
    })
    expect(result).toBe(0.8)
  })

  it("active, never recalled → 0.5", () => {
    const result = evaluateStatusAppropriateness({
      status: "active",
      recallCount: 0,
      lastRecalledAt: null,
      archivedAt: null,
    })
    expect(result).toBe(0.5)
  })

  it("archived, recently → 0.8", () => {
    const result = evaluateStatusAppropriateness({
      status: "archived",
      recallCount: 0,
      lastRecalledAt: null,
      archivedAt: Date.now() - 30 * DAY_MS,
    })
    expect(result).toBe(0.8)
  })

  it("archived, >180d → 0.3", () => {
    const result = evaluateStatusAppropriateness({
      status: "archived",
      recallCount: 0,
      lastRecalledAt: null,
      archivedAt: Date.now() - 200 * DAY_MS,
    })
    expect(result).toBe(0.3)
  })

  it("archived, no timestamp → 0.5", () => {
    const result = evaluateStatusAppropriateness({
      status: "archived",
      recallCount: 0,
      lastRecalledAt: null,
      archivedAt: null,
    })
    expect(result).toBe(0.5)
  })
})

describe("evaluateStability", () => {
  it("no history → stable", () => {
    const result = evaluateStability(undefined)
    expect(result.score).toBe(1.0)
    expect(result.oscillationDetected).toBe(false)
  })

  it("no archive/restore events → stable", () => {
    const result = evaluateStability([
      { action: "created", timestamp: 1000, actor: "user" },
    ])
    expect(result.score).toBe(1.0)
    expect(result.oscillationDetected).toBe(false)
  })

  it("single archive event → stable", () => {
    const result = evaluateStability([
      { action: "created", timestamp: 1000, actor: "user" },
      { action: "archived", timestamp: 2000, actor: "repair" },
    ])
    expect(result.score).toBe(1.0)
    expect(result.oscillationDetected).toBe(false)
  })

  it("2-3 archive/restore events → some oscillation", () => {
    const result = evaluateStability([
      { action: "created", timestamp: 1000, actor: "user" },
      { action: "archived", timestamp: 2000, actor: "repair" },
      { action: "restored", timestamp: 3000, actor: "repair" },
      { action: "archived", timestamp: 4000, actor: "repair" },
    ])
    expect(result.score).toBeLessThan(1.0)
    expect(result.oscillationDetected).toBe(true)
  })

  it("4+ events → significant oscillation", () => {
    const result = evaluateStability([
      { action: "created", timestamp: 1000, actor: "user" },
      { action: "archived", timestamp: 2000, actor: "repair" },
      { action: "restored", timestamp: 3000, actor: "repair" },
      { action: "archived", timestamp: 4000, actor: "repair" },
      { action: "restored", timestamp: 5000, actor: "repair" },
    ])
    expect(result.score).toBeLessThanOrEqual(0.6)
    expect(result.oscillationDetected).toBe(true)
  })
})

describe("computeLifecycleValidity", () => {
  it("active, recently recalled → high score", () => {
    const input: LifecycleValidityInput = {
      status: "active",
      recallCount: 5,
      lastRecalledAt: new Date(Date.now() - DAY_MS).toISOString(),
      archivedAt: null,
      mtimeMs: Date.now(),
    }
    const result = computeLifecycleValidity(input)
    expect(result.score).toBeGreaterThanOrEqual(0.9)
    expect(result.status).toBe("active")
  })

  it("archived, >180d → low score", () => {
    const input: LifecycleValidityInput = {
      status: "archived",
      recallCount: 0,
      lastRecalledAt: null,
      archivedAt: Date.now() - 200 * DAY_MS,
      mtimeMs: Date.now(),
    }
    const result = computeLifecycleValidity(input)
    expect(result.score).toBeLessThanOrEqual(0.55)
    expect(result.status).toBe("archived")
  })
})