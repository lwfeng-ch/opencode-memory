import { describe, test, expect } from "vitest"
import { ConflictAnalyzer } from "../../src/audit/analyzer/conflict.js"
import type { AuditedMemory } from "../../src/audit/index.js"
import type { EvaluationContext } from "../../src/evaluation/types.js"
import type { MemoryHeader } from "../../src/config.js"

function makeMemory(filename: string, content: string, confidence: string = "inferred", description: string = "test"): AuditedMemory {
  const header: MemoryHeader = {
    filename,
    filePath: filename,
    mtimeMs: Date.now(),
    description,
    type: undefined,
    scope: undefined,
    confidence: confidence as MemoryHeader["confidence"],
    schemaVersion: 1,
    recallCount: 0,
    lastRecalledAt: null,
  }
  return { filename, content, header, mtimeMs: header.mtimeMs, scope: "project" }
}

const ctx: EvaluationContext = { now: Date.now(), config: {} as any }

describe("ConflictAnalyzer", () => {
  test("detects Python version conflict", () => {
    const analyzer = new ConflictAnalyzer()
    const mems = [
      makeMemory("python_old.md", "---\nname: Python\n---\n\nUser uses Python 3.9 for development.", "inferred", "Python version"),
      makeMemory("python_new.md", "---\nname: Python\n---\n\nUser upgraded to Python 3.12.", "explicit", "Python version"),
    ]
    const findings = analyzer.analyze(mems, ctx)
    expect(findings.length).toBeGreaterThan(0)
    expect(findings[0].category).toBe("conflict")
  })

  test("suggests override by confidence", () => {
    const analyzer = new ConflictAnalyzer()
    const mems = [
      makeMemory("old.md", "---\nname: Test\n---\n\nUser uses TensorFlow version 2.10 for machine learning.", "inferred", "ML framework"),
      makeMemory("new.md", "---\nname: Test\n---\n\nUser switched from TensorFlow to PyTorch version 2.0.", "explicit", "ML framework"),
    ]
    const findings = analyzer.analyze(mems, ctx)
    const conflict = findings.find((f) => f.category === "conflict")
    expect(conflict).toBeDefined()
    expect(conflict!.suggestion).toContain("higher confidence")
  })

  test("no conflict on different topics", () => {
    const analyzer = new ConflictAnalyzer()
    const mems = [
      makeMemory("python.md", "---\nname: Python\n---\n\nUser uses Python 3.10.", "explicit", "Python language"),
      makeMemory("weather.md", "---\nname: Weather\n---\n\nThe weather is sunny today.", "inferred", "Weather report"),
    ]
    const findings = analyzer.analyze(mems, ctx)
    expect(findings.length).toBe(0)
  })

  test("no conflict on identical content (that's a duplicate)", () => {
    const analyzer = new ConflictAnalyzer()
    const content = "---\nname: Test\n---\n\nUser uses Python 3.10."
    const mems = [
      makeMemory("a.md", content, "explicit", "Python version"),
      makeMemory("b.md", content, "explicit", "Python version"),
    ]
    const findings = analyzer.analyze(mems, ctx)
    expect(findings.length).toBe(0)
  })

  test("reports each pair at most once", () => {
    const analyzer = new ConflictAnalyzer()
    const mems = [
      makeMemory("old.md", "---\nname: Test\n---\n\nUser uses Python 3.9 for development.", "inferred", "Python version 3.9"),
      makeMemory("new.md", "---\nname: Test\n---\n\nUser upgraded to Python 3.12 for development.", "explicit", "Python version 3.12"),
    ]
    const findings = analyzer.analyze(mems, ctx)
    const conflicts = findings.filter((f) => f.category === "conflict")
    // Should be at most 1 finding for this pair (deduplication)
    expect(conflicts.length).toBeLessThanOrEqual(1)
  })
})
