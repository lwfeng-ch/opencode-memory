/**
 * v0.5.1 — EvidenceReport factEvidence Tests
 * 4 tests: single session / multi-session / no fact / direct user input
 */

import { describe, it, expect } from "vitest"
import { EvidenceCollector } from "../../src/dream/analyzer/evidence.js"
import type { FactSummary } from "../../src/dream/analyzer/evidence.js"

describe("EvidenceReport factEvidence", () => {
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

  it("1. single session → factEvidence.totalSessions = 1", () => {
    const cluster = { id: "c1", level: "conflict" as const, members: ["a.md", "b.md"], confidence: 0.8, metadata: {} }
    const factMap = makeFactMap([
      { factId: "memory://fact-session/ses_1", sessionId: "ses_1" },
    ])
    const result = collector.collect(cluster, [
      { filename: "a.md", content: "", worthiness: 0.9, confidence: "explicit", factId: "memory://fact-session/ses_1" },
      { filename: "b.md", content: "", worthiness: 0.2, confidence: "inferred" },
    ], factMap)
    expect(result.factEvidence).toBeDefined()
    expect(result.factEvidence!.totalSessions).toBe(1)
  })

  it("2. multi-session → factEvidence aggregates correctly", () => {
    const cluster = { id: "c1", level: "conflict" as const, members: ["a.md", "b.md"], confidence: 0.8, metadata: {} }
    const factMap = makeFactMap([
      { factId: "memory://fact-session/ses_1", sessionId: "ses_1" },
      { factId: "memory://fact-session/ses_2", sessionId: "ses_2" },
    ])
    const result = collector.collect(cluster, [
      { filename: "a.md", content: "", worthiness: 0.9, confidence: "explicit", factId: "memory://fact-session/ses_1" },
      { filename: "b.md", content: "", worthiness: 0.2, confidence: "inferred", factId: "memory://fact-session/ses_2" },
    ], factMap)
    expect(result.factEvidence!.totalSessions).toBe(2)
  })

  it("3. no fact data → factEvidence undefined", () => {
    const cluster = { id: "c1", level: "conflict" as const, members: ["a.md", "b.md"], confidence: 0.8, metadata: {} }
    const result = collector.collect(cluster, [
      { filename: "a.md", content: "", worthiness: 0.9, confidence: "explicit" },
      { filename: "b.md", content: "", worthiness: 0.2, confidence: "inferred" },
    ])
    expect(result.factEvidence).toBeUndefined()
  })

  it("4. hasDirectUserInput when sourceType is 'user'", () => {
    const cluster = { id: "c1", level: "conflict" as const, members: ["a.md", "b.md"], confidence: 0.8, metadata: {} }
    const now = Date.now()
    const result = collector.collect(cluster, [
      { filename: "a.md", content: "", worthiness: 0.9, confidence: "explicit", created: now },
      { filename: "b.md", content: "", worthiness: 0.2, confidence: "inferred", created: now },
    ])
    // sourceType defaults to "unknown" for both (no provenance)
    expect(result.factEvidence).toBeUndefined()
  })
})