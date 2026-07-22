/**
 * Tests for v0.4.3 Phase A1 — RecallEvent
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdir, rm } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"
import { randomUUID } from "crypto"
import {
  RecallEventStore,
  generateRecallEventId,
  type RecallEvent,
  type UserFeedback,
  type RecallMode,
  type RecallStrategy,
  type FeedbackValue,
  type FeedbackSource,
} from "../../src/recall/feedback.js"

let tmpDir: string
let store: RecallEventStore

beforeEach(async () => {
  tmpDir = join(tmpdir(), `recall-test-${randomUUID()}`)
  await mkdir(tmpDir, { recursive: true })
  store = new RecallEventStore(tmpDir)
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

function makeEvent(overrides: Partial<RecallEvent> = {}): RecallEvent {
  return {
    id: generateRecallEventId(),
    sessionId: "ses_1",
    query: "user preference for bun",
    timestamp: Date.now(),
    scope: "project",
    mode: "active",
    strategy: "hybrid",
    results: [
      { filename: "a.md", score: 0.9, rank: 0 },
      { filename: "b.md", score: 0.5, rank: 1 },
    ],
    ...overrides,
  }
}

describe("RecallEvent types", () => {
  it("should accept active mode", () => {
    const mode: RecallMode = "active"
    expect(mode).toBe("active")
  })

  it("should accept historical mode", () => {
    const mode: RecallMode = "historical"
    expect(mode).toBe("historical")
  })

  it("should accept three strategies", () => {
    const strategies: RecallStrategy[] = ["semantic", "keyword", "hybrid"]
    expect(strategies).toHaveLength(3)
  })
})

describe("UserFeedback types", () => {
  it("should accept three feedback values", () => {
    const values: FeedbackValue[] = ["positive", "negative", "ignored"]
    expect(values).toHaveLength(3)
  })

  it("should accept three feedback sources", () => {
    const sources: FeedbackSource[] = ["user", "system", "benchmark"]
    expect(sources).toHaveLength(3)
  })
})

describe("RecallEventStore", () => {
  it("should log an event", async () => {
    const event = makeEvent()
    await store.logEvent(event)
    const events = await store.getEvents()
    expect(events).toHaveLength(1)
    expect(events[0].query).toBe("user preference for bun")
  })

  it("should log feedback", async () => {
    const event = makeEvent()
    await store.logEvent(event)

    const feedback: UserFeedback = {
      recallEventId: event.id,
      filename: "a.md",
      feedback: "positive",
      source: "user",
      timestamp: Date.now(),
    }
    await store.logFeedback(feedback)

    const feedbacks = await store.getFeedbackForEvent(event.id)
    expect(feedbacks).toHaveLength(1)
    expect(feedbacks[0].feedback).toBe("positive")
    expect(feedbacks[0].source).toBe("user")
  })

  it("should get events with since filter", async () => {
    const old = makeEvent({ timestamp: 1000 })
    const recent = makeEvent({ timestamp: 3000 })
    await store.logEvent(old)
    await store.logEvent(recent)

    const events = await store.getEvents({ since: 2000 })
    expect(events).toHaveLength(1)
    expect(events[0].timestamp).toBe(3000)
  })

  it("should return empty for non-existent event feedback", async () => {
    const feedbacks = await store.getFeedbackForEvent("nonexistent")
    expect(feedbacks).toHaveLength(0)
  })

  it("should handle empty store", async () => {
    const events = await store.getEvents()
    expect(events).toHaveLength(0)
  })
})