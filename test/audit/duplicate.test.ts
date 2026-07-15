import { describe, test, expect, beforeEach, afterEach } from "vitest"
import { DuplicateAnalyzer } from "../../src/audit/analyzer/duplicate.js"
import type { AuditedMemory } from "../../src/audit/index.js"
import type { EvaluationContext } from "../../src/evaluation/types.js"
import type { MemoryHeader } from "../../src/config.js"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

function makeMemory(filename: string, content: string, overrides: Partial<MemoryHeader> = {}): AuditedMemory {
  const header: MemoryHeader = {
    filename,
    filePath: join("mock", filename),
    mtimeMs: Date.now(),
    description: null,
    type: undefined,
    scope: undefined,
    confidence: "inferred",
    schemaVersion: 1,
    recallCount: 0,
    lastRecalledAt: null,
    ...overrides,
  }
  return { filename, content, header, mtimeMs: header.mtimeMs, scope: "project" }
}

const ctx: EvaluationContext = { now: Date.now(), config: {} as any }

describe("DuplicateAnalyzer", () => {
  test("detects semantic duplicates (Jaccard > 0.8)", () => {
    const analyzer = new DuplicateAnalyzer()
    const mems = [
      makeMemory("a.md", "---\nname: A\ndescription: test\n---\n\nUser prefers Python for AI development and machine learning projects."),
      makeMemory("b.md", "---\nname: B\ndescription: test\n---\n\nUser prefers Python for machine learning and AI development projects."),
    ]
    const findings = analyzer.analyze(mems, ctx)
    expect(findings.length).toBe(1)
    expect(findings[0].category).toBe("duplicate")
    expect(findings[0].files).toContain("a.md")
    expect(findings[0].files).toContain("b.md")
  })

  test("no false positives on unique files", () => {
    const analyzer = new DuplicateAnalyzer()
    const mems = [
      makeMemory("a.md", "---\nname: A\n---\n\nUser is a senior Go engineer who prefers backend development."),
      makeMemory("b.md", "---\nname: B\n---\n\nThe weather today is sunny with a high of 25 degrees."),
      makeMemory("c.md", "---\nname: C\n---\n\nThe project uses React and TypeScript for the frontend."),
    ]
    const findings = analyzer.analyze(mems, ctx)
    expect(findings.length).toBe(0)
  })

  test("skips empty content files", () => {
    const analyzer = new DuplicateAnalyzer()
    const mems = [
      makeMemory("empty.md", "---\nname: Empty\n---\n\n"),
      makeMemory("real.md", "---\nname: Real\n---\n\nUser prefers Python for AI development."),
    ]
    const findings = analyzer.analyze(mems, ctx)
    expect(findings.length).toBe(0)
  })

  test("detects 3-way duplicate cluster", () => {
    const analyzer = new DuplicateAnalyzer()
    const mems = [
      makeMemory("a.md", "---\nname: A\n---\n\nUser uses Python 3.10 for development purposes."),
      makeMemory("b.md", "---\nname: B\n---\n\nUser uses Python 3.10 for development purposes."),
      makeMemory("c.md", "---\nname: C\n---\n\nUser uses Python 3.10 for development purposes."),
    ]
    const findings = analyzer.analyze(mems, ctx)
    // 3 pairs: a-b, a-c, b-c
    expect(findings.length).toBe(3)
  })
})
