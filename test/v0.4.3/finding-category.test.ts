/**
 * Tests for v0.4.3 Phase A2 — FindingCategory
 */

import { describe, it, expect } from "vitest"
import type { FindingCategory } from "../../src/validation/worthiness.js"

describe("FindingCategory", () => {
  it("should have 8 categories", () => {
    const categories: FindingCategory[] = [
      "quality",
      "lifecycle",
      "provenance",
      "duplicate",
      "contradiction",
      "superseded",
      "feedback",
      "retrieval",
    ]
    expect(categories).toHaveLength(8)
  })

  it("should accept 'quality'", () => {
    const cat: FindingCategory = "quality"
    expect(cat).toBe("quality")
  })

  it("should accept 'contradiction'", () => {
    const cat: FindingCategory = "contradiction"
    expect(cat).toBe("contradiction")
  })

  it("should accept 'feedback'", () => {
    const cat: FindingCategory = "feedback"
    expect(cat).toBe("feedback")
  })

  it("should accept 'retrieval'", () => {
    const cat: FindingCategory = "retrieval"
    expect(cat).toBe("retrieval")
  })
})