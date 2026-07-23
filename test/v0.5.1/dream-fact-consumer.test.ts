/**
 * v0.5.1 — DreamRunner fact consumption Tests
 * 4 tests: empty facts / with facts / conflict cluster enhanced / EvidenceMember sourceType
 */

import { describe, it, expect } from "vitest"
import { DreamRunner, collectFacts } from "../../src/dream/planner.js"
import { EvidenceCollector } from "../../src/dream/analyzer/evidence.js"
import type { ConflictGraph, ConflictComponent } from "../../src/conflict/types.js"

function makeGraph(components: ConflictComponent[]): ConflictGraph {
  return {
    nodes: components.flatMap((c) => c.memories.map((id) => ({ id, claims: [] }))),
    edges: components.flatMap((c) => c.edges),
    components,
  }
}

function edge(source: string, target: string, type: "contradiction" | "duplicate" | "superseded", confidence: number) {
  return { id: `e_${source}_${target}`, source, target, type, claimKey: "x:y", confidence }
}

function component(memories: string[], edges: typeof edge extends (...args: unknown[]) => infer R ? R[] : never[]) {
  return { id: `comp_${memories.join("_")}`, memories, edges, size: memories.length }
}

describe("DreamRunner — fact consumption", () => {
  const runner = new DreamRunner()

  it("1. empty facts → report still valid", async () => {
    const now = Date.now()
    const graph = makeGraph([{
      id: "c1",
      memories: ["a.md", "b.md"],
      edges: [edge("a.md", "b.md", "contradiction", 0.75)],
      size: 2,
    }])
    const report = await runner.run(graph, [
      { filename: "a.md", content: "User prefers vscode", worthiness: 0.9, confidence: "explicit", created: now },
      { filename: "b.md", content: "User prefers cursor", worthiness: 0.1, confidence: "inferred", created: now },
    ], "v0.5", new Map())
    expect(report.totalClusters).toBeGreaterThan(0)
    expect(report.errors).toEqual([])
  })

  it("2. with fact summaries → pipeline completes", async () => {
    const now = Date.now()
    const factMap = new Map()
    factMap.set("memory://fact-session/ses_1", [{
      sessionId: "ses_1",
      factId: "memory://fact-session/ses_1",
      messageCount: 10,
      toolCallCount: 5,
      durationMinutes: 30,
      gitBranch: "main",
    }])
    const graph = makeGraph([{
      id: "c1",
      memories: ["a.md", "b.md"],
      edges: [edge("a.md", "b.md", "superseded", 0.85)],
      size: 2,
    }])
    const report = await runner.run(graph, [
      { filename: "a.md", content: "User prefers vscode", worthiness: 0.95, confidence: "explicit", created: now, factId: "memory://fact-session/ses_1" },
      { filename: "b.md", content: "User prefers cursor", worthiness: 0.05, confidence: "uncertain", created: now },
    ], "v0.5", factMap)
    expect(report.errors).toEqual([])
  })

  it("3. collectFacts returns empty for non-existent dir", async () => {
    const facts = await collectFacts("/nonexistent/path")
    expect(facts).toBeInstanceOf(Map)
    expect(facts.size).toBe(0)
  })

  it("4. EvidenceMember has sourceType field", () => {
    const now = Date.now()
    const cluster = { id: "c1", level: "conflict" as const, members: ["a.md", "b.md"], confidence: 0.8, metadata: {} }
    const ec = new EvidenceCollector()
    const result = ec.collect(cluster, [
      { filename: "a.md", content: "", worthiness: 0.9, confidence: "explicit", created: now },
      { filename: "b.md", content: "", worthiness: 0.2, confidence: "inferred", created: now },
    ])
    for (const member of result.members) {
      expect(member.sourceType).toBeDefined()
    }
  })
})