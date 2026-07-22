/**
 * opencode-memory — RecallEvent and UserFeedback (v0.4.3)
 *
 * Append-only JSONL event store for recall feedback. Feedback modifies
 * retrieval behavior, not memory truth.
 *
 * See: docs/superpowers/specs/v0.4.3/01-recall-event.md
 */

import { mkdir, appendFile, readFile } from "fs/promises"
import { join, dirname } from "path"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RecallMode = "active" | "historical"
export type RecallStrategy = "semantic" | "keyword" | "hybrid"
export type FeedbackValue = "positive" | "negative" | "ignored"
export type FeedbackSource = "user" | "system" | "benchmark"

export interface RecallEvent {
  id: string
  sessionId: string
  query: string
  timestamp: number
  scope: "user" | "project"
  mode: RecallMode
  strategy: RecallStrategy
  retrievalConfigHash?: string
  results: Array<{
    filename: string
    score: number
    rank: number
  }>
  selected?: string
}

export interface UserFeedback {
  recallEventId: string
  filename: string
  feedback: FeedbackValue
  source: FeedbackSource
  timestamp: number
  sessionId?: string
  comment?: string
}

// ---------------------------------------------------------------------------
// RecallEventStore
// ---------------------------------------------------------------------------

export class RecallEventStore {
  constructor(private baseDir: string) {}

  /**
   * Log a recall event. Writes to events-YYYY-MM-DD.jsonl.
   */
  async logEvent(event: RecallEvent): Promise<void> {
    const filePath = this.eventFilePath(event.timestamp)
    await mkdir(dirname(filePath), { recursive: true })
    await appendFile(filePath, JSON.stringify(event) + "\n", "utf-8")
  }

  /**
   * Log user feedback. Writes to feedback-YYYY-MM-DD.jsonl.
   */
  async logFeedback(feedback: UserFeedback): Promise<void> {
    const filePath = this.feedbackFilePath(feedback.timestamp)
    await mkdir(dirname(filePath), { recursive: true })
    await appendFile(filePath, JSON.stringify(feedback) + "\n", "utf-8")
  }

  /**
   * Get all events, optionally filtered by since timestamp.
   */
  async getEvents(options?: { since?: number; limit?: number }): Promise<RecallEvent[]> {
    const filePath = join(this.baseDir, "recall", "events.jsonl")
    try {
      const content = await readFile(filePath, "utf-8")
      const lines = content.trim().split("\n").filter(Boolean)
      let events = lines.map((line) => JSON.parse(line) as RecallEvent)

      if (options?.since) {
        events = events.filter((e) => e.timestamp >= options.since!)
      }

      if (options?.limit) {
        events = events.slice(-options.limit)
      }

      return events
    } catch {
      return []
    }
  }

  /**
   * Get all feedback for a specific recall event.
   */
  async getFeedbackForEvent(eventId: string): Promise<UserFeedback[]> {
    const filePath = join(this.baseDir, "recall", "feedback.jsonl")
    try {
      const content = await readFile(filePath, "utf-8")
      return content
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as UserFeedback)
        .filter((f) => f.recallEventId === eventId)
    } catch {
      return []
    }
  }

  private eventFilePath(_timestamp: number): string {
    return join(this.baseDir, "recall", "events.jsonl")
  }

  private feedbackFilePath(_timestamp: number): string {
    return join(this.baseDir, "recall", "feedback.jsonl")
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let recallEventCounter = 0

export function generateRecallEventId(): string {
  recallEventCounter++
  return `recall_${Date.now().toString(36)}_${recallEventCounter.toString(36)}`
}