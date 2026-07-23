/**
 * v0.5.1 — Extraction provenance factId Tests
 * 4 tests: factId injection / missing scenario / old format compat / factId propagates
 */

import { describe, it, expect } from "vitest"
import { buildProvenanceFrontmatter } from "../../src/extraction/writer.js"

describe("Extraction provenance factId", () => {
  it("1. buildProvenanceFrontmatter includes fact_id", () => {
    const result = buildProvenanceFrontmatter("ses_abc", "Test Memory", "A test memory")
    expect(result).toContain("fact_id")
    expect(result).toContain("ses_abc")
  })

  it("2. missing sessionId → fact_id still present", () => {
    const result = buildProvenanceFrontmatter("", "Test", "Desc")
    expect(result).toContain("fact_id")
  })

  it("3. old format compatibility — no name/description", () => {
    const result = buildProvenanceFrontmatter("ses_abc", null, null)
    expect(result).toContain("fact_id")
    expect(result).toContain("ses_abc")
  })

  it("4. frontmatter has correct YAML structure", () => {
    const result = buildProvenanceFrontmatter("ses_abc", "Test", "Desc")
    expect(result).toContain("source:")
    expect(result).toContain("kind: extraction")
    expect(result).toContain("fact_id: ses_abc")
    expect(result).toContain("---")
  })
})