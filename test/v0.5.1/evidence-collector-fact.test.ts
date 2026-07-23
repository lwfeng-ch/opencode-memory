/**
 * v0.5.1 — EvidenceCollector fact integration Tests
 * 4 tests: dedup stats / session span / dominant enhanced / MemoryFile.factId
 */

import { describe, it, expect } from "vitest"
import { EvidenceCollector, type FactSummary } from "../../src/dream/analyzer/evidence.js"

describe("EvidenceCollector — fact integration", () => {
  const collector = new EvidenceCollector()

  function makeFactMap(entries: Array<{ factId: string; sessionId: string }>): Map<string, FactSummary[]> {
    const map = new Map<string, FactSummary[]>()
    for (const e of entries) {
      const existing = map.get(e.factId) ?? []
      existing.push({
        sessionId: e.sessionId,
        factId: e.factId,
        messageCount: 10,
        toolCallCount: 5,
        durationMinutes: 30,
        gitBranch: "main",
      })
      map.set(e.factId, existing)
    }
    return map
  }

  it("1. dedup — same factId across multiple members → 1 session", () => {
    const cluster = { id: "c1", level: "conflict" as const, members: ["a.md", "b.md"], confidence: 0.8, metadata: {} }
    const factMap = makeFactMap([
      { factId: "memory://fact-session/ses_1", sessionId: "ses_1" },
    ])
    const result = collector.collect(cluster, [
      { filename: "a.md", content: "", worthiness: 0.9, confidence: "explicit", factId: "memory://fact-session/ses_1" },
      { filename: "b.md", content: "", worthiness: 0.2, confidence: "inferred", factId: "memory://fact-session/ses_1" },
    ], factMap)
    expect(result.factEvidence!.totalSessions).toBe(1)
  })

  it("2. multiple factIds → total sessions aggregated", () => {
    const cluster = { id: "c1", level: "conflict" as const, members: ["a.md", "b.md", "c.md"], confidence: 0.8, metadata: {} }
    const factMap = makeFactMap([
      { factId: "memory://fact-session/ses_1", sessionId: "ses_1" },
      { factId: "memory://fact-session/ses_2", sessionId: "ses_2" },
      { factId: "memory://fact-session/ses_3", sessionId: "ses_3" },
    ])
    const result = collector.collect(cluster, [
      { filename: "a.md", content: "", worthiness: 0.9, confidence: "explicit", factId: "memory://fact-session/ses_1" },
      { filename: "b.md", content: "", worthiness: 0.2, confidence: "inferred", factId: "memory://fact-session/ses_2" },
      { filename: "c.md", content: "", worthiness: 0.3, confidence: "inferred", factId: "memory://fact-session/ses_3" },
    ], factMap)
    expect(result.factEvidence!.totalSessions).toBe(3)
  })

  it("3. MemoryFile.factId → member.factId populated", () => {
    const cluster = { id: "c1", level: "conflict" as const, members: ["a.md"], confidence: 0.8, metadata: {} }
    const result = collector.collect(cluster, [
      { filename: "a.md", content: "", worthiness: 0.5, confidence: "explicit", factId: "memory://fact-session/ses_1" },
    ])
    expect(result.members[0].factId).toBe("memory://fact-session/ses_1")
  })

  it("4. no factMap → factEvidence undefined", () => {
    const cluster = { id: "c1", level: "conflict" as const, members: ["a.md", "b.md"], confidence: 0.8, metadata: {} }
    const result = collector.collect(cluster, [
      { filename: "a.md", content: "", worthiness: 0.9, confidence: "explicit", factId: "memory://fact-session/ses_1" },
      { filename: "b.md", content: "", worthiness: 0.2, confidence: "inferred", factId: "memory://fact-session/ses_2" },
    ])
    // factSummaries not provided → factEvidence not computed
    expect(result.factEvidence).toBeUndefined()
  })
})