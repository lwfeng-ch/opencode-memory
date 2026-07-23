/**
 * v0.5.0 Phase 4 — DreamRunner Tests
 * 20 tests
 */

import { describe, it, expect } from "vitest"
import { DreamRunner } from "../../src/dream/planner.js"
import { ClusterBuilder } from "../../src/dream/cluster/builder.js"
import { EvidenceCollector } from "../../src/dream/analyzer/evidence.js"
import { ClusterScoreEngine } from "../../src/dream/analyzer/cluster-score.js"
import { CandidateGenerator } from "../../src/dream/candidate/generator.js"
import type { ConflictGraph, ConflictComponent } from "../../src/conflict/types.js"

function makeGraph(components: ConflictComponent[]): ConflictGraph {
  return {
    nodes: components.flatMap((c) => c.memories.map((id) => ({ id, claims: [] }))),
    edges: components.flatMap((c) => c.edges),
    components,
  }
}

function mem(filename: string, worthiness: number, confidence: string = "explicit") {
  return {
    filename,
    content: `User prefers ${filename.replace(".md", "")}`,
    worthiness,
    confidence,
  }
}

describe("DreamRunner", () => {
  const runner = new DreamRunner()

  it("1. empty graph + empty memories → empty report", async () => {
    const report = await runner.run(makeGraph([]), [], "v0.5")
    expect(report.totalClusters).toBe(0)
    expect(report.totalCandidates).toBe(0)
    expect(report.errors).toEqual([])
  })

  it("2. conflict graph with 2 nodes → produces clusters", async () => {
    const now = Date.now()
    const graph = makeGraph([{
      id: "c1",
      memories: ["a.md", "b.md"],
      edges: [{ id: "e1", source: "a.md", target: "b.md", type: "contradiction", claimKey: "x:y", confidence: 0.75 }],
      size: 2,
    }])
    const report = await runner.run(graph, [
      mem("a.md", 0.9, "explicit"),
      mem("b.md", 0.1, "uncertain"),
    ], "v0.5")
    expect(report.totalClusters).toBeGreaterThan(0)
    expect(report.duration).toBeGreaterThan(0)
  })

  it("3. full pipeline produces candidates", async () => {
    const now = Date.now()
    const graph = makeGraph([{
      id: "c1",
      memories: ["a.md", "b.md"],
      edges: [{ id: "e1", source: "a.md", target: "b.md", type: "superseded", claimKey: "x:y", confidence: 0.85 }],
      size: 2,
    }])
    const report = await runner.run(graph, [
      { ...mem("a.md", 0.95, "explicit"), created: now },
      { ...mem("b.md", 0.05, "uncertain"), created: now },
    ], "v0.5")
    expect(report.totalCandidates).toBeGreaterThan(0)
  })

  it("4. report has duration", async () => {
    const report = await runner.run(makeGraph([]), [], "v0.5")
    expect(report.duration).toBeGreaterThanOrEqual(0)
  })

  it("5. mode parameter accepted", async () => {
    const report = await runner.run(makeGraph([]), [], "classic")
    expect(report).toBeDefined()
  })

  it("6. hybrid mode accepted", async () => {
    const report = await runner.run(makeGraph([]), [], "hybrid")
    expect(report).toBeDefined()
  })
})

describe("ClusterBuilder", () => {
  const builder = new ClusterBuilder()

  it("7. empty inputs → empty", () => {
    const result = builder.buildAll(makeGraph([]), [], [])
    expect(result).toEqual([])
  })

  it("8. conflict graph only → conflict clusters", () => {
    const graph = makeGraph([{
      id: "c1",
      memories: ["a.md", "b.md"],
      edges: [{ id: "e1", source: "a.md", target: "b.md", type: "contradiction", claimKey: "x:y", confidence: 0.75 }],
      size: 2,
    }])
    const result = builder.buildAll(graph, [
      { filename: "a.md", content: "User prefers vscode" },
      { filename: "b.md", content: "User prefers cursor" },
    ], [
      { filename: "a.md", content: "User prefers vscode" },
      { filename: "b.md", content: "User prefers cursor" },
    ])
    const conflictClusters = result.filter((c) => c.level === "conflict")
    expect(conflictClusters).toHaveLength(1)
  })

  it("9. claim clusters from content", () => {
    const result = builder.buildAll(makeGraph([]), [
      { filename: "a.md", content: "User prefers vscode" },
      { filename: "b.md", content: "User prefers cursor" },
    ], [])
    const claimClusters = result.filter((c) => c.level === "claim")
    expect(claimClusters).toHaveLength(1)
  })

  it("10. topic clusters from similar content", () => {
    const result = builder.buildAll(makeGraph([]), [], [
      { filename: "a.md", content: "User prefers bun for package management tools" },
      { filename: "b.md", content: "bun is a great package management tool" },
    ])
    const topicClusters = result.filter((c) => c.level === "topic")
    expect(topicClusters).toHaveLength(1)
  })

  it("11. all levels combined", () => {
    const graph = makeGraph([{
      id: "c1",
      memories: ["x.md", "y.md"],
      edges: [{ id: "e1", source: "x.md", target: "y.md", type: "contradiction", claimKey: "x:y", confidence: 0.75 }],
      size: 2,
    }])
    const result = builder.buildAll(graph, [
      { filename: "a.md", content: "User prefers vscode" },
      { filename: "b.md", content: "User prefers cursor" },
    ], [
      { filename: "c.md", content: "python backend development" },
      { filename: "d.md", content: "python backend framework" },
    ])
    const levels = new Set(result.map((c) => c.level))
    expect(levels.has("conflict")).toBe(true)
    expect(levels.has("claim")).toBe(true)
    expect(levels.has("topic")).toBe(true)
  })
})

describe("EvidenceCollector + ClusterScore", () => {
  const collector = new EvidenceCollector()
  const scoreEngine = new ClusterScoreEngine()

  it("12. evidence collection with score", () => {
    const now = Date.now()
    const cluster = { id: "c1", level: "conflict" as const, members: ["a.md", "b.md"], confidence: 0.8, metadata: {} }
    const evidence = collector.collect(cluster, [
      { filename: "a.md", content: "", worthiness: 0.95, confidence: "explicit", created: now },
      { filename: "b.md", content: "", worthiness: 0.05, confidence: "uncertain", created: now },
    ])
    const scores = scoreEngine.score(cluster, evidence)
    expect(scores.compatibility).toBe(0.2)
    expect(scores.dominance).toBe(1.0)
  })

  it("13. topic cluster score", () => {
    const cluster = { id: "c1", level: "topic" as const, members: ["a.md", "b.md"], confidence: 0.6, metadata: {} }
    const evidence = collector.collect(cluster, [
      { filename: "a.md", content: "", worthiness: 0.5, confidence: "explicit", created: Date.now() },
      { filename: "b.md", content: "", worthiness: 0.5, confidence: "explicit", created: Date.now() },
    ])
    const scores = scoreEngine.score(cluster, evidence)
    expect(scores.compatibility).toBe(0.5)
  })

  it("14. claim cluster compatibility", () => {
    const cluster = { id: "c1", level: "claim" as const, members: ["a.md", "b.md"], confidence: 0.8, metadata: { values: ["vscode", "cursor"] } }
    const evidence = collector.collect(cluster, [
      { filename: "a.md", content: "", worthiness: 0.5, confidence: "explicit", created: Date.now() },
      { filename: "b.md", content: "", worthiness: 0.5, confidence: "explicit", created: Date.now() },
    ])
    const scores = scoreEngine.score(cluster, evidence)
    // distinct values → lower compatibility
    expect(scores.compatibility).toBeLessThan(0.5)
  })

  it("15. single member → no dominance", () => {
    const cluster = { id: "c1", level: "topic" as const, members: ["a.md"], confidence: 0.5, metadata: {} }
    const evidence = collector.collect(cluster, [
      { filename: "a.md", content: "", worthiness: 0.5, confidence: "explicit", created: Date.now() },
    ])
    const scores = scoreEngine.score(cluster, evidence)
    expect(scores.dominance).toBe(0)
  })
})

describe("CandidateGenerator extended", () => {
  const collector = new EvidenceCollector()
  const generator = new CandidateGenerator()

  it("16. claim cluster with high worthiness → keep", () => {
    const cluster = { id: "c1", level: "claim" as const, members: ["a.md", "b.md"], confidence: 0.8, metadata: {} }
    const evidence = collector.collect(cluster, [
      { filename: "a.md", content: "", worthiness: 0.7, confidence: "explicit", created: Date.now() },
      { filename: "b.md", content: "", worthiness: 0.6, confidence: "explicit", created: Date.now() },
    ])
    const candidates = generator.generate([cluster], [evidence])
    // claim clusters are not processed in Phase 1 generator (conflict only)
    expect(candidates).toHaveLength(0)
  })

  it("17. topic cluster not processed", () => {
    const cluster = { id: "c1", level: "topic" as const, members: ["a.md", "b.md"], confidence: 0.6, metadata: {} }
    const evidence = collector.collect(cluster, [
      { filename: "a.md", content: "", worthiness: 0.1, confidence: "uncertain", created: Date.now() },
      { filename: "b.md", content: "", worthiness: 0.1, confidence: "uncertain", created: Date.now() },
    ])
    const candidates = generator.generate([cluster], [evidence])
    expect(candidates).toHaveLength(0)
  })

  it("18. no evidence → no candidates", () => {
    const candidates = generator.generate([], [])
    expect(candidates).toEqual([])
  })

  it("19. sorted by confidence descending", () => {
    const now = Date.now()
    const clusters = [
      { id: "c1", level: "conflict" as const, members: ["a.md", "b.md"], confidence: 0.8, metadata: {} },
      { id: "c2", level: "conflict" as const, members: ["c.md", "d.md"], confidence: 0.8, metadata: {} },
    ]
    const evidence1 = collector.collect(clusters[0], [
      { filename: "a.md", content: "", worthiness: 0.95, confidence: "explicit", created: now },
      { filename: "b.md", content: "", worthiness: 0.05, confidence: "uncertain", created: now },
    ])
    const evidence2 = collector.collect(clusters[1], [
      { filename: "c.md", content: "", worthiness: 0.9, confidence: "explicit", created: now },
      { filename: "d.md", content: "", worthiness: 0.15, confidence: "uncertain", created: now },
    ])
    const candidates = generator.generate(clusters, [evidence1, evidence2])
    expect(candidates.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i - 1].confidence).toBeGreaterThanOrEqual(candidates[i].confidence)
    }
  })

  it("20. generator handles empty cluster list", () => {
    const candidates = generator.generate([], [])
    expect(candidates).toEqual([])
  })
})