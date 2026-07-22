/**
 * Tests for v0.4.2 Phase A2 — Claim Extractor
 */

import { describe, it, expect } from "vitest"
import { ClaimExtractor, containsSupersededSignal } from "../../src/conflict/claim-extractor.js"

const extractor = new ClaimExtractor()

describe("ClaimExtractor — pattern-based", () => {
  it('should extract "User prefers bun" → claim(user, preference, bun)', () => {
    const claims = extractor.extractClaims("User prefers bun for all projects.", "test.md")
    expect(claims).toHaveLength(1)
    expect(claims[0].subject).toBe("user")
    expect(claims[0].predicate).toBe("preference")
    expect(claims[0].value).toBe("bun")
  })

  it('should extract "User uses Python" → claim(user, uses, python)', () => {
    const claims = extractor.extractClaims("User uses Python for all projects.", "test.md")
    expect(claims).toHaveLength(1)
    expect(claims[0].subject).toBe("user")
    expect(claims[0].predicate).toBe("uses")
    expect(claims[0].value).toBe("python")
  })

  it('should extract "Project uses qdrant" → claim(project, uses, qdrant)', () => {
    const claims = extractor.extractClaims("Project uses qdrant for vector storage.", "test.md")
    expect(claims).toHaveLength(1)
    expect(claims[0].subject).toBe("project")
    expect(claims[0].predicate).toBe("uses")
    expect(claims[0].value).toBe("qdrant")
  })

  it('should extract "Now using bun" → claim(user, uses, bun)', () => {
    const claims = extractor.extractClaims("Now using bun for all projects.", "test.md")
    expect(claims).toHaveLength(1)
    expect(claims[0].subject).toBe("user")
    expect(claims[0].predicate).toBe("uses")
    expect(claims[0].value).toBe("bun")
  })

  it('should extract "Switched to npm" → claim(user, uses, npm)', () => {
    const claims = extractor.extractClaims("Switched to npm for package management.", "test.md")
    expect(claims).toHaveLength(1)
    expect(claims[0].subject).toBe("user")
    expect(claims[0].predicate).toBe("uses")
    expect(claims[0].value).toBe("npm")
  })
})

describe("ClaimExtractor — multiple claims", () => {
  it("should extract multiple claims from one memory", () => {
    const claims = extractor.extractClaims(
      "User uses bun for development. Project uses qdrant for storage.",
      "test.md",
    )
    expect(claims.length).toBeGreaterThanOrEqual(2)
  })
})

describe("ClaimExtractor — empty content", () => {
  it("should return empty array for empty content", () => {
    const claims = extractor.extractClaims("", "test.md")
    expect(claims).toHaveLength(0)
  })
})

describe("ClaimExtractor — fallback", () => {
  it("should generate fallback claim for generic content", () => {
    const claims = extractor.extractClaims(
      "The weather is nice today.",
      "test.md",
    )
    // "The weather is nice today" doesn't match any pattern → fallback
    expect(claims.length).toBeGreaterThanOrEqual(1)
    expect(claims[0].subject).toBe("memory")
    expect(claims[0].predicate).toBe("about")
  })

  it("should set sourceMemory correctly", () => {
    const claims = extractor.extractClaims("User prefers bun.", "my-memory.md")
    expect(claims[0].sourceMemory).toBe("my-memory.md")
  })
})

describe("containsSupersededSignal", () => {
  it("should detect 'switched to'", () => {
    expect(containsSupersededSignal("User switched to bun")).toBe(true)
  })

  it("should detect 'migrated to'", () => {
    expect(containsSupersededSignal("Project migrated to qdrant")).toBe(true)
  })

  it("should detect 'now using'", () => {
    expect(containsSupersededSignal("Now using Python 3.12")).toBe(true)
  })

  it("should return false for normal content", () => {
    expect(containsSupersededSignal("User prefers bun")).toBe(false)
  })
})