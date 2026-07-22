/**
 * Tests for v0.4.1 Phase C3 — Content Regression
 *
 * Verifies that v0.3.1 quality scores are unchanged by v0.4.1 changes.
 */

import { describe, it, expect } from "vitest"
import { checkCompleteness, checkNoise, checkFreshness } from "../../src/evaluation/quality.js"
import type { QualityMemory } from "../../src/evaluation/quality-score.js"

function makeMemory(overrides: Partial<QualityMemory> = {}): QualityMemory {
  return {
    filename: "test.md",
    content: "meaningful content",
    name: "Test Name",
    description: "A test description",
    type: "user",
    scope: "user",
    confidence: "explicit",
    recallCount: 5,
    lastRecalledAt: new Date().toISOString(),
    mtimeMs: Date.now(),
    ...overrides,
  }
}

describe("v0.3.1 quality regression — checkCompleteness unchanged", () => {
  it("complete memory → 100", () => {
    const score = checkCompleteness([makeMemory()])
    expect(score).toBe(100)
  })

  it("missing name → < 100", () => {
    const score = checkCompleteness([makeMemory({ name: "" })])
    expect(score).toBeLessThan(100)
  })
})

describe("v0.3.1 quality regression — checkNoise unchanged", () => {
  it("clean content → 100", () => {
    const score = checkNoise([makeMemory()])
    expect(score).toBe(100)
  })

  it("placeholder content → < 100", () => {
    const score = checkNoise([makeMemory({ content: "TODO: fill this in later" })])
    expect(score).toBeLessThan(100)
  })
})

describe("v0.3.1 quality regression — checkFreshness unchanged", () => {
  it("recently recalled → 100", () => {
    const score = checkFreshness([makeMemory()])
    expect(score).toBe(100)
  })
})