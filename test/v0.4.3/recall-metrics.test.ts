/**
 * Tests for v0.4.3 Phase B — Recall Metrics
 */

import { describe, it, expect } from "vitest"
import { computeRecallMetrics, computeRetrievalAdjustment } from "../../src/recall/metrics.js"
import type { RecallEvent, UserFeedback } from "../../src/recall/feedback.js"

function makeEvent(overrides: Partial<RecallEvent> = {}): RecallEvent {
  return {
    id: "e1",
    sessionId: "ses_1",
    query: "test",
    timestamp: 1000,
    scope: "project",
    mode: "active",
    strategy: "hybrid",
    results: [
      { filename: "a.md", score: 0.9, rank: 0 },
      { filename: "b.md", score: 0.5, rank: 1 },
      { filename: "c.md", score: 0.3, rank: 2 },
    ],
    ...overrides,
  }
}

describe("computeRecallMetrics", () => {
  it("empty events → empty metrics", () => {
    const metrics = computeRecallMetrics([], [])
    expect(metrics.totalRecalls).toBe(0)
    expect(metrics.precisionAt1).toBe(0)
    expect(metrics.perMemory).toHaveLength(0)
  })

  it("all selected top-1 → precision@1 = 1.0", () => {
    const events = [
      makeEvent({ selected: "a.md" }),
      makeEvent({ selected: "a.md" }),
    ]
    const metrics = computeRecallMetrics(events, [])
    expect(metrics.precisionAt1).toBe(1.0)
  })

  it("half selected → hitRate = 0.5", () => {
    const events = [
      makeEvent({ selected: "a.md" }),
      makeEvent({}), // not selected
    ]
    const metrics = computeRecallMetrics(events, [])
    expect(metrics.hitRate).toBe(0.5)
  })

  it("all positive feedback → positiveRatio = 1.0", () => {
    const events = [
      makeEvent({ id: "e1", selected: "a.md" }),
      makeEvent({ id: "e2", selected: "b.md" }),
    ]
    const feedbacks: UserFeedback[] = [
      { recallEventId: "e1", filename: "a.md", feedback: "positive", source: "user", timestamp: 1000 },
      { recallEventId: "e2", filename: "b.md", feedback: "positive", source: "user", timestamp: 1000 },
    ]
    const metrics = computeRecallMetrics(events, feedbacks)
    expect(metrics.positiveRatio).toBe(1.0)
  })

  it("per-memory: 5 recalls, 4 positive → usefulness = 0.8", () => {
    const events = Array.from({ length: 5 }, (_, i) => ({
      ...makeEvent({ id: `e${i}`, results: [{ filename: "a.md", score: 0.9, rank: 0 }] }),
    }))
    const feedbacks: UserFeedback[] = Array.from({ length: 4 }, (_, i) => ({
      recallEventId: `e${i}`,
      filename: "a.md",
      feedback: "positive" as const,
      source: "user" as const,
      timestamp: 1000,
    }))

    const metrics = computeRecallMetrics(events, feedbacks)
    const memory = metrics.perMemory.find((m) => m.filename === "a.md")
    expect(memory).toBeDefined()
    expect(memory!.recallCount).toBe(5)
    expect(memory!.usefulness).toBe(1.0) // 4/4 positive
  })
})

describe("computeRetrievalAdjustment", () => {
  it("useful memory → scoreModifier = +0.1", () => {
    const metrics = computeRecallMetrics(
      Array.from({ length: 5 }, (_, i) => ({
        ...makeEvent({ id: `e${i}`, results: [{ filename: "a.md", score: 0.9, rank: 0 }] }),
      })),
      Array.from({ length: 4 }, (_, i) => ({
        recallEventId: `e${i}`,
        filename: "a.md",
        feedback: "positive" as const,
        source: "user" as const,
        timestamp: 1000,
      })),
    )
    const adj = computeRetrievalAdjustment(metrics, "a.md")
    expect(adj.scoreModifier).toBe(0.1)
    expect(adj.reason).toBe("consistently useful")
  })

  it("negative memory → scoreModifier = -0.1", () => {
    const metrics = computeRecallMetrics(
      Array.from({ length: 5 }, (_, i) => ({
        ...makeEvent({ id: `e${i}`, results: [{ filename: "a.md", score: 0.9, rank: 0 }] }),
      })),
      Array.from({ length: 4 }, (_, i) => ({
        recallEventId: `e${i}`,
        filename: "a.md",
        feedback: "negative" as const,
        source: "user" as const,
        timestamp: 1000,
      })),
    )
    const adj = computeRetrievalAdjustment(metrics, "a.md")
    expect(adj.scoreModifier).toBe(-0.1)
    expect(adj.reason).toBe("consistently negative feedback")
  })

  it("insufficient data → scoreModifier = 0", () => {
    const metrics = computeRecallMetrics(
      [makeEvent({ results: [{ filename: "a.md", score: 0.9, rank: 0 }] })],
      [],
    )
    const adj = computeRetrievalAdjustment(metrics, "a.md")
    expect(adj.scoreModifier).toBe(0)
    expect(adj.reason).toBe("insufficient data")
  })
})