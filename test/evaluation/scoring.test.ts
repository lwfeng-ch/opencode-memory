import { describe, test, expect } from "vitest"
import { scoreMemory, scoreMemories } from "../../src/evaluation/scoring.js"
import type { MemoryHeader } from "../../src/config.js"

function makeHeader(overrides: Partial<MemoryHeader> = {}): MemoryHeader {
  return {
    filename: "test.md",
    filePath: "/tmp/test.md",
    mtimeMs: Date.now(),
    description: "test description",
    type: undefined,
    scope: undefined,
    confidence: "inferred",
    schemaVersion: 1,
    recallCount: 0,
    lastRecalledAt: null,
    ...overrides,
  }
}

describe("scoreMemory", () => {
  test("keyword match in name/description returns score > 0", () => {
    const header = makeHeader({ description: "User prefers Python for AI" })
    expect(scoreMemory("python", header)).toBeGreaterThan(0)
  })

  test("keyword match in filename returns score > 0", () => {
    const header = makeHeader({ filename: "python_env.md", description: null })
    expect(scoreMemory("python", header)).toBeGreaterThan(0)
  })

  test("no keyword match returns score 0", () => {
    const header = makeHeader({ description: "Weather is sunny today" })
    expect(scoreMemory("python", header)).toBe(0)
  })

  test("type bonus adds to score when type matches query", () => {
    const header = makeHeader({ type: "user", description: "role info" })
    const score = scoreMemory("user role", header)
    expect(score).toBeGreaterThan(0)
  })

  test("freshness bonus only applies when keyword/type score > 0", () => {
    const recentHeader = makeHeader({ description: "unrelated content", recallCount: 5 })
    const oldHeader = makeHeader({ description: "unrelated content", mtimeMs: Date.now() - 365 * 24 * 60 * 60 * 1000 })
    // Neither has keyword match, so both should be 0
    expect(scoreMemory("python", recentHeader)).toBe(0)
    expect(scoreMemory("python", oldHeader)).toBe(0)
  })

  test("freshness bonus amplifies when keyword match exists", () => {
    const recentHeader = makeHeader({ description: "Python environment", mtimeMs: Date.now() })
    const oldHeader = makeHeader({ description: "Python environment", mtimeMs: Date.now() - 365 * 24 * 60 * 60 * 1000 })
    const recentScore = scoreMemory("python", recentHeader)
    const oldScore = scoreMemory("python", oldHeader)
    expect(recentScore).toBeGreaterThan(oldScore)
  })
})

describe("scoreMemories", () => {
  test("returns sorted array by score descending", () => {
    const headers = [
      makeHeader({ filename: "low.md", description: "unrelated" }),
      makeHeader({ filename: "high.md", description: "Python expert" }),
      makeHeader({ filename: "mid.md", description: "Python beginner" }),
    ]
    const results = scoreMemories("python", headers)
    expect(results[0].header.filename).toBe("high.md")
    expect(results[0].score).toBeGreaterThanOrEqual(results[1].score)
  })

  test("empty headers returns empty array", () => {
    expect(scoreMemories("query", [])).toEqual([])
  })
})
