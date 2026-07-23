/**
 * v0.5.0 Phase 1 — ConflictAdapter Tests
 *
 * 20 tests across 5 groups:
 * 1. Basic Adapter (5)
 * 2. Conflict Type Preservation (4)
 * 3. Evidence Collection (5)
 * 4. Candidate Generation (4)
 * 5. Integration (2)
 */

import { describe, it, expect } from "vitest"
import { ConflictClusterAdapter } from "../../src/dream/cluster/conflict-adapter.js"
import { EvidenceCollector } from "../../src/dream/analyzer/evidence.js"
import { CandidateGenerator } from "../../src/dream/candidate/generator.js"
import type { ConflictGraph, ConflictComponent, ConflictEdge, ConflictType } from "../../src/conflict/types.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGraph(components: ConflictComponent[]): ConflictGraph {
  return {
    nodes: components.flatMap((c) => c.memories.map((id) => ({ id, claims: [] }))),
    edges: components.flatMap((c) => c.edges),
    components,
  }
}

function edge(
  source: string,
  target: string,
  type: ConflictType,
  confidence: number,
): ConflictEdge {
  return { id: `e_${source}_${target}`, source, target, type, claimKey: "x:y", confidence }
}

function component(memories: string[], edges: ConflictEdge[]): ConflictComponent {
  return { id: `comp_${memories.join("_")}`, memories, edges, size: memories.length }
}

// ---------------------------------------------------------------------------
// 1. Basic Adapter (5 tests)
// ---------------------------------------------------------------------------

describe("ConflictClusterAdapter — basic", () => {
  const adapter = new ConflictClusterAdapter()

  it("1. empty graph → []", () => {
    const graph = makeGraph([])
    expect(adapter.fromGraph(graph)).toEqual([])
  })

  it("2. single 2-node component → 1 cluster with 2 members", () => {
    const graph = makeGraph([
      component(["a.md", "b.md"], [edge("a.md", "b.md", "contradiction", 0.75)]),
    ])
    const clusters = adapter.fromGraph(graph)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].level).toBe("conflict")
    expect(clusters[0].members).toEqual(["a.md", "b.md"])
  })

  it("3. 3 components → 3 clusters", () => {
    const graph = makeGraph([
      component(["a.md", "b.md"], [edge("a.md", "b.md", "contradiction", 0.75)]),
      component(["c.md", "d.md"], [edge("c.md", "d.md", "duplicate", 0.95)]),
      component(["e.md", "f.md"], [edge("e.md", "f.md", "superseded", 0.85)]),
    ])
    expect(adapter.fromGraph(graph)).toHaveLength(3)
  })

  it("4. 1-node component → filtered (not in output)", () => {
    const graph = makeGraph([
      component(["a.md"], []),
      component(["b.md", "c.md"], [edge("b.md", "c.md", "contradiction", 0.75)]),
    ])
    const clusters = adapter.fromGraph(graph)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].members).toEqual(["b.md", "c.md"])
  })

  it("5. 3-node component → 1 cluster with 3 members", () => {
    const graph = makeGraph([
      component(
        ["a.md", "b.md", "c.md"],
        [
          edge("a.md", "b.md", "contradiction", 0.75),
          edge("b.md", "c.md", "contradiction", 0.75),
        ],
      ),
    ])
    const clusters = adapter.fromGraph(graph)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].members).toEqual(["a.md", "b.md", "c.md"])
  })
})

// ---------------------------------------------------------------------------
// 2. Conflict Type Preservation (4 tests)
// ---------------------------------------------------------------------------

describe("ConflictClusterAdapter — conflict type preservation", () => {
  const adapter = new ConflictClusterAdapter()

  it("6. duplicate conflict → metadata.conflictTypes includes 'duplicate'", () => {
    const graph = makeGraph([
      component(["a.md", "b.md"], [edge("a.md", "b.md", "duplicate", 0.95)]),
    ])
    const clusters = adapter.fromGraph(graph)
    expect(clusters[0].metadata.conflictTypes).toContain("duplicate")
  })

  it("7. contradiction conflict → metadata.conflictTypes includes 'contradiction'", () => {
    const graph = makeGraph([
      component(["a.md", "b.md"], [edge("a.md", "b.md", "contradiction", 0.75)]),
    ])
    const clusters = adapter.fromGraph(graph)
    expect(clusters[0].metadata.conflictTypes).toContain("contradiction")
  })

  it("8. superseded conflict → metadata.conflictTypes includes 'superseded'", () => {
    const graph = makeGraph([
      component(["a.md", "b.md"], [edge("a.md", "b.md", "superseded", 0.85)]),
    ])
    const clusters = adapter.fromGraph(graph)
    expect(clusters[0].metadata.conflictTypes).toContain("superseded")
  })

  it("9. mixed types → both preserved", () => {
    const graph = makeGraph([
      component(
        ["a.md", "b.md", "c.md"],
        [
          edge("a.md", "b.md", "contradiction", 0.75),
          edge("b.md", "c.md", "duplicate", 0.95),
        ],
      ),
    ])
    const clusters = adapter.fromGraph(graph)
    expect(clusters[0].metadata.conflictTypes).toContain("contradiction")
    expect(clusters[0].metadata.conflictTypes).toContain("duplicate")
  })
})

// ---------------------------------------------------------------------------
// 3. Evidence Collection (5 tests)
// ---------------------------------------------------------------------------

describe("EvidenceCollector — evidence collection", () => {
  const collector = new EvidenceCollector()

  it("10. worthiness aggregation → members have correct scores", () => {
    const cluster = { id: "c1", level: "conflict" as const, members: ["a.md", "b.md"], confidence: 0.8, metadata: {} }
    const result = collector.collect(cluster, [
      { filename: "a.md", content: "", worthiness: 0.9, confidence: "explicit" },
      { filename: "b.md", content: "", worthiness: 0.2, confidence: "inferred" },
    ])
    expect(result.members).toHaveLength(2)
    expect(result.members.find((m) => m.filename === "a.md")?.worthiness).toBe(0.9)
    expect(result.members.find((m) => m.filename === "b.md")?.worthiness).toBe(0.2)
  })

  it("11. dominant detection → marks dominant when gap >= 0.3", () => {
    const now = Date.now()
    const cluster = { id: "c1", level: "conflict" as const, members: ["a.md", "b.md", "c.md"], confidence: 0.8, metadata: {} }
    const result = collector.collect(cluster, [
      { filename: "a.md", content: "", worthiness: 0.95, confidence: "explicit", created: now },
      { filename: "b.md", content: "", worthiness: 0.05, confidence: "uncertain", created: now },
      { filename: "c.md", content: "", worthiness: 0.1, confidence: "uncertain", created: now },
    ])
    expect(result.dominant).toBe("a.md")
  })

  it("12. no dominant when gap < 0.3", () => {
    const cluster = { id: "c1", level: "conflict" as const, members: ["a.md", "b.md"], confidence: 0.8, metadata: {} }
    const result = collector.collect(cluster, [
      { filename: "a.md", content: "", worthiness: 0.6, confidence: "explicit" },
      { filename: "b.md", content: "", worthiness: 0.5, confidence: "explicit" },
    ])
    expect(result.dominant).toBeUndefined()
  })

  it("13. confidence mapping → explicit=1.0, inferred=0.6, uncertain=0.3", () => {
    const cluster = { id: "c1", level: "conflict" as const, members: ["a.md", "b.md"], confidence: 0.8, metadata: {} }
    const result = collector.collect(cluster, [
      { filename: "a.md", content: "", worthiness: 0.5, confidence: "explicit" },
      { filename: "b.md", content: "", worthiness: 0.5, confidence: "uncertain" },
    ])
    expect(result.members.find((m) => m.filename === "a.md")?.confidence).toBe(1.0)
    expect(result.members.find((m) => m.filename === "b.md")?.confidence).toBe(0.3)
  })

  it("14. single member → member populated, no dominant", () => {
    const cluster = { id: "c1", level: "conflict" as const, members: ["a.md"], confidence: 0.8, metadata: {} }
    const result = collector.collect(cluster, [
      { filename: "a.md", content: "", worthiness: 0.5, confidence: "explicit" },
    ])
    expect(result.members).toHaveLength(1)
    expect(result.dominant).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 4. Candidate Generation (4 tests)
// ---------------------------------------------------------------------------

describe("CandidateGenerator — candidate generation", () => {
  const collector = new EvidenceCollector()
  const generator = new CandidateGenerator()

  it("15. dominant + low worthiness members → archive candidate", () => {
    const now = Date.now()
    const cluster = { id: "c1", level: "conflict" as const, members: ["a.md", "b.md"], confidence: 0.8, metadata: {} }
    const evidence = collector.collect(cluster, [
      { filename: "a.md", content: "", worthiness: 0.95, confidence: "explicit", created: now },
      { filename: "b.md", content: "", worthiness: 0.05, confidence: "uncertain", created: now },
    ])
    const candidates = generator.generate([cluster], [evidence])
    expect(candidates).toHaveLength(1)
    expect(candidates[0].action).toBe("archive")
    expect(candidates[0].targets).toEqual(["b.md"])
  })

  it("16. all similar worthiness → no candidate (keep)", () => {
    const cluster = { id: "c1", level: "conflict" as const, members: ["a.md", "b.md"], confidence: 0.8, metadata: {} }
    const evidence = collector.collect(cluster, [
      { filename: "a.md", content: "", worthiness: 0.6, confidence: "explicit" },
      { filename: "b.md", content: "", worthiness: 0.5, confidence: "explicit" },
    ])
    const candidates = generator.generate([cluster], [evidence])
    expect(candidates).toHaveLength(0)
  })

  it("17. low worthiness → confidence > 0.7", () => {
    const now = Date.now()
    const cluster = { id: "c1", level: "conflict" as const, members: ["a.md", "b.md"], confidence: 0.8, metadata: {} }
    const evidence = collector.collect(cluster, [
      { filename: "a.md", content: "", worthiness: 0.95, confidence: "explicit", created: now },
      { filename: "b.md", content: "", worthiness: 0.05, confidence: "uncertain", created: now },
    ])
    const candidates = generator.generate([cluster], [evidence])
    expect(candidates[0].confidence).toBeGreaterThan(0.7)
  })

  it("18. archive action → riskHint < 0.3", () => {
    const now = Date.now()
    const cluster = { id: "c1", level: "conflict" as const, members: ["a.md", "b.md"], confidence: 0.8, metadata: {} }
    const evidence = collector.collect(cluster, [
      { filename: "a.md", content: "", worthiness: 0.95, confidence: "explicit", created: now },
      { filename: "b.md", content: "", worthiness: 0.05, confidence: "uncertain", created: now },
    ])
    const candidates = generator.generate([cluster], [evidence])
    expect(candidates[0].riskHint).toBeLessThan(0.3)
  })
})

// ---------------------------------------------------------------------------
// 5. Integration (2 tests)
// ---------------------------------------------------------------------------

describe("ConflictAdapter — full pipeline integration", () => {
  const adapter = new ConflictClusterAdapter()
  const collector = new EvidenceCollector()
  const generator = new CandidateGenerator()

  it("19. ConflictGraph → Cluster → Evidence → Candidate full pipeline", () => {
    const now = Date.now()
    const graph = makeGraph([
      component(["a.md", "b.md"], [edge("a.md", "b.md", "superseded", 0.85)]),
    ])

    const clusters = adapter.fromGraph(graph)
    expect(clusters).toHaveLength(1)

    const evidence = collector.collect(clusters[0], [
      { filename: "a.md", content: "", worthiness: 0.95, confidence: "explicit", created: now },
      { filename: "b.md", content: "", worthiness: 0.05, confidence: "uncertain", created: now },
    ])
    expect(evidence.dominant).toBe("a.md")

    const candidates = generator.generate(clusters, [evidence])
    expect(candidates).toHaveLength(1)
    expect(candidates[0].action).toBe("archive")
    expect(candidates[0].targets).toEqual(["b.md"])
    expect(candidates[0].clusterId).toBe(clusters[0].id)
  })

  it("20. adapter does not modify original ConflictGraph", () => {
    const components = [
      component(["a.md", "b.md"], [edge("a.md", "b.md", "contradiction", 0.75)]),
    ]
    const graph = makeGraph(components)
    const graphBefore = JSON.stringify(graph)

    adapter.fromGraph(graph)

    expect(JSON.stringify(graph)).toBe(graphBefore)
  })
})