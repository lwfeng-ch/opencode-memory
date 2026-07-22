/**
 * Tests for v0.4.2 Phase B1 — ConflictGraph
 */

import { describe, it, expect } from "vitest"
import { ConflictGraphBuilder, getResolutionOrder, isInConflict, getConflictedMemories } from "../../src/conflict/graph.js"
import { type MemoryClaim } from "../../src/conflict/types.js"

function makeClaim(overrides: Partial<MemoryClaim> = {}): MemoryClaim {
  return {
    id: overrides.id ?? "c1",
    subject: "user",
    predicate: "uses",
    value: "bun",
    sourceMemory: "a.md",
    ...overrides,
  }
}

describe("ConflictGraphBuilder — connected components", () => {
  it("A→B, B→C (same claim key) → 1 component of 3", () => {
    const claims: MemoryClaim[] = [
      makeClaim({ id: "c1", value: "bun", sourceMemory: "a.md" }),
      makeClaim({ id: "c2", value: "npm", sourceMemory: "b.md" }),
      makeClaim({ id: "c3", value: "pnpm", sourceMemory: "c.md" }),
    ]
    const graph = new ConflictGraphBuilder().build(claims)
    expect(graph.components).toHaveLength(1)
    expect(graph.components[0].size).toBe(3)
    expect(graph.components[0].memories).toContain("a.md")
    expect(graph.components[0].memories).toContain("b.md")
    expect(graph.components[0].memories).toContain("c.md")
  })

  it("A→B (claim key X), C→D (claim key Y) → 2 components", () => {
    const claims: MemoryClaim[] = [
      makeClaim({ id: "c1", value: "bun", sourceMemory: "a.md" }),
      makeClaim({ id: "c2", value: "npm", sourceMemory: "b.md" }),
      makeClaim({ id: "c3", subject: "project", predicate: "db", value: "qdrant", sourceMemory: "c.md" }),
      makeClaim({ id: "c4", subject: "project", predicate: "db", value: "milvus", sourceMemory: "d.md" }),
    ]
    const graph = new ConflictGraphBuilder().build(claims)
    expect(graph.components).toHaveLength(2)
  })

  it("empty claims → 0 edges, 0 components", () => {
    const graph = new ConflictGraphBuilder().build([])
    expect(graph.edges).toHaveLength(0)
    expect(graph.components).toHaveLength(0)
  })

  it("single conflict → 1 component of 2", () => {
    const claims: MemoryClaim[] = [
      makeClaim({ id: "c1", value: "bun", sourceMemory: "a.md" }),
      makeClaim({ id: "c2", value: "npm", sourceMemory: "b.md" }),
    ]
    const graph = new ConflictGraphBuilder().build(claims)
    expect(graph.components).toHaveLength(1)
    expect(graph.components[0].size).toBe(2)
  })
})

describe("ConflictGraphBuilder — classification", () => {
  it("same claim key, same value → duplicate", () => {
    const claims: MemoryClaim[] = [
      makeClaim({ id: "c1", value: "bun", sourceMemory: "a.md" }),
      makeClaim({ id: "c2", value: "bun", sourceMemory: "b.md" }),
    ]
    const graph = new ConflictGraphBuilder().build(claims)
    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0].type).toBe("duplicate")
    expect(graph.edges[0].confidence).toBeGreaterThanOrEqual(0.9)
  })

  it("same claim key, different value → contradiction", () => {
    const claims: MemoryClaim[] = [
      makeClaim({ id: "c1", value: "bun", sourceMemory: "a.md" }),
      makeClaim({ id: "c2", value: "npm", sourceMemory: "b.md" }),
    ]
    const graph = new ConflictGraphBuilder().build(claims)
    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0].type).toBe("contradiction")
  })

  it("same file, same claim → skip (self-conflict)", () => {
    const claims: MemoryClaim[] = [
      makeClaim({ id: "c1", value: "bun", sourceMemory: "a.md" }),
      makeClaim({ id: "c2", value: "npm", sourceMemory: "a.md" }),
    ]
    const graph = new ConflictGraphBuilder().build(claims)
    expect(graph.edges).toHaveLength(0)
  })
})

describe("getResolutionOrder", () => {
  it("should sort duplicates first, then superseded, then contradiction", () => {
    const component = {
      id: "comp1",
      memories: ["a.md", "b.md", "c.md"],
      edges: [
        { id: "e1", source: "a.md", target: "b.md", type: "contradiction" as const, claimKey: "user:uses", confidence: 0.75 },
        { id: "e2", source: "b.md", target: "c.md", type: "duplicate" as const, claimKey: "user:uses", confidence: 0.95 },
        { id: "e3", source: "a.md", target: "c.md", type: "superseded" as const, claimKey: "user:uses", confidence: 0.85 },
      ],
      size: 3,
    }
    const order = getResolutionOrder(component)
    expect(order[0].type).toBe("duplicate")   // highest confidence + easiest
    expect(order[1].type).toBe("superseded")
    expect(order[2].type).toBe("contradiction")
  })
})

describe("isInConflict", () => {
  it("should return true for conflicted memory", () => {
    const claims = [makeClaim({ sourceMemory: "a.md" })]
    const graph = new ConflictGraphBuilder().build(claims)
    expect(isInConflict(graph, "a.md")).toBe(true)
  })

  it("should return false for clean memory", () => {
    const graph = new ConflictGraphBuilder().build([])
    expect(isInConflict(graph, "nonexistent.md")).toBe(false)
  })
})

describe("getConflictedMemories", () => {
  it("should return all unique filenames", () => {
    const claims = [
      makeClaim({ sourceMemory: "a.md" }),
      makeClaim({ sourceMemory: "b.md" }),
    ]
    const graph = new ConflictGraphBuilder().build(claims)
    const memories = getConflictedMemories(graph)
    expect(memories.has("a.md")).toBe(true)
    expect(memories.has("b.md")).toBe(true)
  })
})