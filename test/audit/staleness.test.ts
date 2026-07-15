import { describe, test, expect } from "vitest"
import { StalenessAnalyzer } from "../../src/audit/analyzer/staleness.js"
import type { AuditedMemory } from "../../src/audit/index.js"
import type { EvaluationContext } from "../../src/evaluation/types.js"
import type { MemoryHeader } from "../../src/config.js"

function makeMemory(filename: string, mtimeMs: number, confidence: string = "inferred", recallCount: number = 0): AuditedMemory {
  const header: MemoryHeader = {
    filename,
    filePath: filename,
    mtimeMs,
    description: "test memory",
    type: "project",
    scope: undefined,
    confidence: confidence as MemoryHeader["confidence"],
    schemaVersion: 1,
    recallCount,
    lastRecalledAt: null,
  }
  return { filename, content: `---\nname: Test\n---\n\nContent.`, header, mtimeMs, scope: "project" }
}

const ctx: EvaluationContext = { now: Date.now(), config: {} as any }
const DAY_MS = 24 * 60 * 60 * 1000

describe("StalenessAnalyzer", () => {
  test("flags 200-day-old non-explicit never-recalled", () => {
    const analyzer = new StalenessAnalyzer()
    const mem = makeMemory("old.md", Date.now() - 200 * DAY_MS, "inferred", 0)
    const findings = analyzer.analyze([mem], ctx)
    expect(findings.length).toBe(1)
    expect(findings[0].severity).toBe("info")
    expect(findings[0].message).toContain("200")
  })

  test("does not flag explicit memories even if old", () => {
    const analyzer = new StalenessAnalyzer()
    const mem = makeMemory("explicit_old.md", Date.now() - 200 * DAY_MS, "explicit", 0)
    const findings = analyzer.analyze([mem], ctx)
    expect(findings.length).toBe(0)
  })

  test("does not flag recently recalled memories", () => {
    const analyzer = new StalenessAnalyzer()
    const mem = makeMemory("recalled.md", Date.now() - 200 * DAY_MS, "inferred", 5)
    const findings = analyzer.analyze([mem], ctx)
    expect(findings.length).toBe(0)
  })

  test("flags 35-day-old never-recalled as monitoring", () => {
    const analyzer = new StalenessAnalyzer()
    const mem = makeMemory("monitor.md", Date.now() - 35 * DAY_MS, "inferred", 0)
    const findings = analyzer.analyze([mem], ctx)
    expect(findings.length).toBe(1)
    expect(findings[0].severity).toBe("info")
    expect(findings[0].message).toContain("35")
  })
})
