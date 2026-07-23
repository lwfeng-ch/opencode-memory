/**
 * v0.5.2 — assessRisk Extension Tests
 * 4 tests: backward-compat / dimension-enhanced / fact-evidence / no-options
 */

import { describe, it, expect } from "vitest"
import { assessRisk } from "../../src/repair/candidate.js"

describe("assessRisk extended", () => {
  it("1. backward compatible — no options", () => {
    expect(assessRisk("explicit", null)).toBe("low")
    expect(assessRisk("inferred", 10)).toBe("low")
    expect(assessRisk("inferred", 200)).toBe("high")
  })

  it("2. backward compatible — with daysSinceRecall", () => {
    expect(assessRisk("inferred", 29)).toBe("low")
    expect(assessRisk("inferred", 30)).toBe("medium")
    expect(assessRisk("inferred", 179)).toBe("medium")
    expect(assessRisk("inferred", 180)).toBe("high")
  })

  it("3. with options — worthiness affects risk", () => {
    // Low worthiness doesn't change the existing logic for non-explicit
    const result = assessRisk("inferred", 200, { worthiness: 0.1 })
    expect(result).toBe("high")
  })

  it("4. with options — fact evidence", () => {
    const result = assessRisk("inferred", 200, {
      worthiness: 0.1,
      factEvidence: { totalSessions: 1, hasDirectUserInput: false },
    })
    // Still high because no direct user input and low worthiness
    expect(result).toBe("high")
  })
})