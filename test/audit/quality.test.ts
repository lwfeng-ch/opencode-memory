import { describe, test, expect } from "vitest"
import { QualityAnalyzer } from "../../src/audit/analyzer/quality.js"
import type { AuditedMemory } from "../../src/audit/index.js"
import type { EvaluationContext } from "../../src/evaluation/types.js"
import type { MemoryHeader } from "../../src/config.js"

function makeMemory(filename: string, content: string, overrides: Partial<MemoryHeader> = {}): AuditedMemory {
  const header: MemoryHeader = {
    filename,
    filePath: filename,
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

describe("QualityAnalyzer", () => {
  test("detects truncated description", () => {
    const analyzer = new QualityAnalyzer()
    const mem = makeMemory("garbage.md", `---\nname: Explicit Feedback\ndescription: TDD, follow the user's instructions. ## How to Access Skills **In Codex:*\ntype: feedback\nconfidence: explicit\n---\n\n`)
    const findings = analyzer.analyze([mem], ctx)
    const trunc = findings.find((f) => f.message.includes("truncated"))
    expect(trunc).toBeDefined()
    expect(trunc!.severity).toBe("critical")
  })

  test("detects missing name field", () => {
    const analyzer = new QualityAnalyzer()
    const mem = makeMemory("no_name.md", `---\ndescription: test memory\ntype: project\n---\n\nSome content here.`)
    const findings = analyzer.analyze([mem], ctx)
    const missing = findings.find((f) => f.message.includes("name"))
    expect(missing).toBeDefined()
    expect(missing!.severity).toBe("warning")
  })

  test("detects generic name 'Explicit Feedback'", () => {
    const analyzer = new QualityAnalyzer()
    const mem = makeMemory("generic.md", `---\nname: Explicit Feedback\ndescription: test feedback\ntype: feedback\n---\n\nContent.`)
    const findings = analyzer.analyze([mem], ctx)
    const generic = findings.find((f) => f.message.includes("Generic name"))
    expect(generic).toBeDefined()
    expect(generic!.severity).toBe("info")
  })

  test("detects empty content body", () => {
    const analyzer = new QualityAnalyzer()
    const mem = makeMemory("empty.md", `---\nname: Empty\ndescription: test\ntype: project\n---\n\n`)
    const findings = analyzer.analyze([mem], ctx)
    const empty = findings.find((f) => f.message.includes("empty"))
    expect(empty).toBeDefined()
    expect(empty!.severity).toBe("critical")
  })

  test("passes on well-formed memory", () => {
    const analyzer = new QualityAnalyzer()
    const mem = makeMemory("good.md", `---\nname: User Role\ndescription: Senior Go engineer\ntype: user\nconfidence: explicit\n---\n\nUser is a senior Go engineer.`)
    const findings = analyzer.analyze([mem], ctx)
    expect(findings.length).toBe(0)
  })
})
