import { describe, test, expect } from "vitest"
import { isTransientToolMemory } from "../src/recall.js"
import type { MemoryHeader } from "../src/config.js"

function makeHeader(desc: string, filename: string = "test.md"): MemoryHeader {
  return {
    filename,
    filePath: "",
    mtimeMs: Date.now(),
    description: desc,
    type: undefined,
    scope: undefined,
    confidence: "inferred",
    schemaVersion: undefined,
  }
}

describe("isTransientToolMemory", () => {
  test("excludes transient memory when tool is active", () => {
    const h = makeHeader("npm install failed", "npm_notes.md")
    expect(isTransientToolMemory(h, ["npm"])).toBe(true)
  })

  test("keeps workaround memory even with transient keywords", () => {
    const h = makeHeader("npm install requires --legacy-peer-deps", "npm_workaround.md")
    // "requires" is a durable marker → should NOT be filtered
    expect(isTransientToolMemory(h, ["npm"])).toBe(false)
  })

  test("keeps memory unrelated to active tool", () => {
    const h = makeHeader("user likes Python", "user_pref.md")
    expect(isTransientToolMemory(h, ["npm"])).toBe(false)
  })

  test("keeps all when recentTools is empty", () => {
    const h = makeHeader("npm install failed", "npm_notes.md")
    expect(isTransientToolMemory(h, [])).toBe(false)
  })

  test("keeps known issue even with error keyword", () => {
    const h = makeHeader("npm known issue with Node 18", "npm_known.md")
    expect(isTransientToolMemory(h, ["npm"])).toBe(false)
  })

  test("excludes timed out memory", () => {
    const h = makeHeader("npm install timed out", "npm_debug.md")
    expect(isTransientToolMemory(h, ["npm"])).toBe(true)
  })

  test("handles null description", () => {
    const h = makeHeader("", "npm_notes.md")
    // No tool name in empty description → not related → kept
    expect(isTransientToolMemory(h, ["npm"])).toBe(false)
  })
})
