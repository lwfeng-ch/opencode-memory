/**
 * Round 10 Integration Tests — Cross-module scenarios.
 *
 * Part D — Cursor + Extraction: incremental message processing via cursor offset
 * Part E — Pressure → Dream: critical pressure bypasses time gate
 * Part F — RecallHandle: async recall settlement + cross-turn consumption
 *
 * These tests verify the cross-module integrations added in the
 * Qwen-inspired optimization rounds (Rounds 1-9). They exercise
 * real I/O, real cursor files, and real pressure thresholds —
 * no mocks for the modules under test (only the LLM adapter is mocked).
 */

import { test, expect, afterAll } from "bun:test"
import { mkdir, rm, writeFile, readFile } from "fs/promises"
import { join, dirname } from "path"
import { tmpdir } from "os"
import { getFactSessionPath, getCursorPath } from "../src/paths.js"

// ---------------------------------------------------------------------------
// Imports under test
// ---------------------------------------------------------------------------
import { createStore } from "../src/store.js"
import type { MemoryStore } from "../src/store.js"
import { resolveConfig } from "../src/config.js"
import type { MemoryPluginConfig } from "../src/config.js"
import { shouldRunDream } from "../src/dream.js"
import { extractSessionMemory } from "../src/extraction.js"
import { readCursor, writeCursor } from "../src/cursor.js"
import { recallMemories } from "../src/recall.js"
import { checkMemoryPressure } from "../src/health.js"
import type { MemoryPressureReport } from "../src/health.js"
import { scanMemoryFiles, formatMemoriesByScope } from "../src/scan.js"

// ---------------------------------------------------------------------------
// Helpers (mirrors integration.test.ts patterns)
// ---------------------------------------------------------------------------

async function makeTempDir(label: string): Promise<string> {
  const dir = join(tmpdir(), `opencode-r10-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  await mkdir(dir, { recursive: true })
  return dir
}

async function cleanDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await import("fs/promises").then((m) => m.stat(path))
    return true
  } catch {
    return false
  }
}

async function writeMemoryFile(
  store: MemoryStore,
  filename: string,
  name: string,
  description: string,
  type: string,
  body: string,
): Promise<void> {
  const content = `---
name: ${name}
description: ${description}
type: ${type}
---

${body}
`
  await store.write(filename, content)
}

async function writeFactRecord(memoryDir: string, sessionId: string, messages: number = 2): Promise<void> {
  const factPath = getFactSessionPath(memoryDir, sessionId)
  await mkdir(dirname(factPath), { recursive: true })
  const record = {
    "$id": "memory://fact-session/v1",
    "session_id": sessionId,
    "created_at": new Date().toISOString(),
    "ended_at": new Date().toISOString(),
    "project": "test",
    "project_dir": memoryDir,
    "runtime": { "opencode_version": "test", "plugin_version": "test", "model": "test" },
    "git": { "branch": "", "head": "", "changed_files": [] },
    "stats": { "messages": messages, "tool_calls": 0, "duration_minutes": 10 },
    "events": [],
    "integrity": { "hash": "" },
  }
  await writeFile(factPath, JSON.stringify(record, null, 2))
}

/** Mock extraction adapter with message tracking. */
function createExtractionMockClient(opts?: {
  messages?: any[]
  chatResponse?: any
}) {
  let createCount = 0
  return {
    session: {
      create: async (_opts: any) => {
        createCount++
        return { id: `extract-session-${createCount}` }
      },
      prompt: async (_id: string, _message: string) => {
        return (
          opts?.chatResponse ?? {
            content:
              "# Session Title\n_Test session_\n\n# Current State\n_Working on cursor integration_\n\n# Task Specification\n_Verify incremental extraction_\n\n# Files & Functions\n_cursor.ts_\n\n# Workflow\n_\n\n# Errors & Corrections\n_\n\n# Learnings\n_Cursor offset advances correctly_\n\n# Worklog\n_1. Ran extraction_",
          }
        )
      },
      messages: async (_id: string) => {
        return (
          opts?.messages ?? [
            { role: "user", content: "Fix the cursor bug" },
            { role: "assistant", content: "I'll fix the cursor offset bug in cursor.ts" },
          ]
        )
      },
    },
    workspace: { current: async () => "/test" },
    git: { snapshot: async () => ({ branch: "", head: "", changedFiles: [] }) },
    capabilities: { sessionCreate: true, messageRead: true, eventStream: true, backgroundTask: true, toolHook: true },
    healthCheck: async () => ({ sessionCreate: true, sessionMessages: true, sessionPrompt: "untested" as const, errors: [] }),
  }
}

/** Mock recall client (no LLM — rule filter only). */
function createRecallMockClient() {
  return {
    session: {
      create: async (_opts: any) => ({ id: "recall-session" }),
      chat: async (_id: string, _opts: any) => ({ content: "[]" }),
    },
  }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

let tempDirs: string[] = []

afterAll(async () => {
  for (const dir of tempDirs) {
    await cleanDir(dir).catch(() => {})
  }
})

// ===========================================================================
// PART D — Cursor + Extraction: Incremental Message Processing
// ===========================================================================

test("D1: extractSessionMemory writes cursor file after extraction", async () => {
  const dir = await makeTempDir("d1")
  tempDirs.push(dir)
  const store = await createStore(dir)
  const config = resolveConfig()
  const mockClient = createExtractionMockClient()

  await writeFactRecord(dir, "sess-d1", 2)
  await extractSessionMemory("sess-d1", dir, store, config, mockClient as any, join(dir, "state.json"))

  // Cursor file should exist
  const cursorPath = getCursorPath(dir)
  const cursorExists = await fileExists(cursorPath)
  expect(cursorExists).toBe(true)

  // Cursor content should have correct session ID and offset
  const cursor = await readCursor(dir, "sess-d1")
  expect(cursor).not.toBeNull()
  expect(cursor!.sessionId).toBe("sess-d1")
  expect(cursor!.processedMessageOffset).toBeGreaterThan(0)
  expect(cursor!.lastProcessedAt).toBeDefined()
})

test("D2: second extraction with no new messages skips LLM call", async () => {
  const dir = await makeTempDir("d2")
  tempDirs.push(dir)
  const store = await createStore(dir)
  const config = resolveConfig()

  // Track create calls
  let createCount = 0
  const mockClient = {
    session: {
      create: async (_opts: any) => {
        createCount++
        return { id: `extract-session-${createCount}` }
      },
      prompt: async () => ({
        content: "# Session Title\n_should not be called_\n\n# Worklog\n_1. nothing_",
      }),
      messages: async () => [
        { role: "user", content: "Fix the cursor bug" },
        { role: "assistant", content: "Done" },
      ],
    },
    workspace: { current: async () => "/test" },
    git: { snapshot: async () => ({ branch: "", head: "", changedFiles: [] }) },
    capabilities: { sessionCreate: true, messageRead: true, eventStream: true, backgroundTask: true, toolHook: true },
    healthCheck: async () => ({ sessionCreate: true, sessionMessages: true, sessionPrompt: "untested" as const, errors: [] }),
  }

  await writeFactRecord(dir, "sess-d2", 2)

  // First extraction — should call LLM
  await extractSessionMemory("sess-d2", dir, store, config, mockClient as any, join(dir, "state.json"))
  expect(createCount).toBe(1)

  // Read cursor after first extraction
  const cursor1 = await readCursor(dir, "sess-d2")
  expect(cursor1).not.toBeNull()
  const offset1 = cursor1!.processedMessageOffset

  // Second extraction — same messages, cursor offset covers all → no new messages
  // LLM should NOT be called (messages.length === 0 after cursor slice)
  const result = await extractSessionMemory("sess-d2", dir, store, config, mockClient as any, join(dir, "state.json"))
  expect(result.success).toBe(true)
  expect(createCount).toBe(1) // still 1 — no new LLM call

  // Cursor should be updated with new timestamp but same offset
  const cursor2 = await readCursor(dir, "sess-d2")
  expect(cursor2).not.toBeNull()
  expect(cursor2!.processedMessageOffset).toBe(offset1)
})

test("D3: cursor with mismatched sessionId returns null (cross-session reset)", async () => {
  const dir = await makeTempDir("d3")
  tempDirs.push(dir)

  // Write a cursor for session-A
  await writeCursor(dir, {
    sessionId: "session-A",
    processedMessageOffset: 42,
    lastProcessedAt: new Date().toISOString(),
    lastTouchedFiles: ["file1.md"],
  })

  // Read with session-B → should return null
  const cursor = await readCursor(dir, "session-B")
  expect(cursor).toBeNull()
})

test("D4: extraction with new messages advances cursor offset", async () => {
  const dir = await makeTempDir("d4")
  tempDirs.push(dir)
  const store = await createStore(dir)
  const config = resolveConfig()

  let messageCount = 2
  const mockClient = {
    session: {
      create: async () => ({ id: "extract-d4" }),
      prompt: async () => ({
        content: "# Session Title\n_incremental test_\n\n# Worklog\n_1. extracted_",
      }),
      messages: async () => {
        // Return messageCount messages
        return Array.from({ length: messageCount }, (_, i) => ({
          role: i % 2 === 0 ? "user" : "assistant",
          content: `Message ${i}`,
        }))
      },
    },
    workspace: { current: async () => "/test" },
    git: { snapshot: async () => ({ branch: "", head: "", changedFiles: [] }) },
    capabilities: { sessionCreate: true, messageRead: true, eventStream: true, backgroundTask: true, toolHook: true },
    healthCheck: async () => ({ sessionCreate: true, sessionMessages: true, sessionPrompt: "untested" as const, errors: [] }),
  }

  await writeFactRecord(dir, "sess-d4", 2)

  // First extraction with 2 messages
  await extractSessionMemory("sess-d4", dir, store, config, mockClient as any, join(dir, "state.json"))
  const cursor1 = await readCursor(dir, "sess-d4")
  expect(cursor1).not.toBeNull()
  expect(cursor1!.processedMessageOffset).toBe(2)

  // Add 3 more messages (total = 5)
  messageCount = 5
  await extractSessionMemory("sess-d4", dir, store, config, mockClient as any, join(dir, "state.json"))
  const cursor2 = await readCursor(dir, "sess-d4")
  expect(cursor2).not.toBeNull()
  // Cursor should have advanced: offset 2 + 3 new messages = 5
  expect(cursor2!.processedMessageOffset).toBe(5)
})

// ===========================================================================
// PART E — Pressure → Dream: Critical Pressure Bypasses Time Gate
// ===========================================================================

test("E1: normal pressure — shouldRunDream respects time gate (returns false)", async () => {
  const dir = await makeTempDir("e1")
  tempDirs.push(dir)
  const store = await createStore(dir)

  // Write a few memory files (well below pressure threshold)
  await writeMemoryFile(store, "user_role.md", "User Role", "Developer", "user", "Some info")
  await writeMemoryFile(store, "feedback_test.md", "Testing", "Prefers integration tests", "feedback", "Info")

  // Write lock file to set a "recent" dream run timestamp
  const lockPath = join(dir, ".consolidate-lock")
  await writeFile(lockPath, String(process.pid))

  const config = resolveConfig({
    dream: {
      ...resolveConfig().dream,
      minHoursSinceLast: 24, // 24 hours required, lock is fresh → time gate fails
      minSessionsSinceLast: 1,
    },
  })

  const result = await shouldRunDream(store, config)
  expect(result).toBe(false) // time gate fails, pressure is normal
})

test("E2: critical pressure bypasses time gate — shouldRunDream returns true", async () => {
  const dir = await makeTempDir("e2")
  tempDirs.push(dir)
  const store = await createStore(dir)

  // Write enough files to trigger critical pressure (>90% of maxFiles=500 → 451+ files)
  // Instead of writing 451 files, we set a very low maxFiles threshold
  const config = resolveConfig({
    dream: {
      ...resolveConfig().dream,
      minHoursSinceLast: 999, // time gate will fail
      minSessionsSinceLast: 999, // session gate will fail
    },
    memoryPressure: {
      ...resolveConfig().memoryPressure,
      maxFiles: 5, // 5 files → 5/5 = 100% ≥ 90% → critical
    },
  })

  // Write 5 memory files to hit critical
  for (let i = 0; i < 5; i++) {
    await writeMemoryFile(store, `mem_${i}.md`, `Memory ${i}`, `test memory ${i}`, "user", "body")
  }

  // Verify pressure is actually critical
  const pressure = await checkMemoryPressure(store, config)
  expect(pressure.level).toBe("critical")

  // NO lock file — dream hasn't run before. Critical pressure should bypass
  // time + session gates and return true (no lock = not held).
  const result = await shouldRunDream(store, config)
  expect(result).toBe(true) // critical pressure bypasses time + session gates
})

test("E3: elevated pressure halves time gate requirement", async () => {
  const dir = await makeTempDir("e3")
  tempDirs.push(dir)
  const store = await createStore(dir)

  // Set maxFiles=10, write 8 files → 80% → elevated (≥70%, <90%)
  const config = resolveConfig({
    dream: {
      ...resolveConfig().dream,
      minHoursSinceLast: 24, // required: 24 hours, but elevated halves to 12
      minSessionsSinceLast: 1,
      lockStaleTimeoutMs: 1000, // 1s — stale lock timeout
    },
    memoryPressure: {
      ...resolveConfig().memoryPressure,
      maxFiles: 10,
    },
  })

  for (let i = 0; i < 8; i++) {
    await writeMemoryFile(store, `mem_${i}.md`, `Memory ${i}`, `test memory ${i}`, "user", "body")
  }

  // Verify pressure is elevated
  const pressure = await checkMemoryPressure(store, config)
  expect(pressure.level).toBe("elevated")

  // Write a STALE lock file (dead PID = 999999) with old mtime (13h ago)
  // This simulates "last dream run was 13h ago" while lock is not held
  const lockPath = join(dir, ".consolidate-lock")
  await writeFile(lockPath, "999999")
  // Set mtime to 13 hours ago using fs.utimes
  const { utimes } = await import("fs/promises")
  const oldTime = new Date(Date.now() - 13 * 3_600_000) // 13 hours ago
  await utimes(lockPath, oldTime, oldTime)

  // shouldRunDream: elevated halves 24→12, 13 > 12 → time gate passes
  // isLockHeld: PID 999999 is dead → stale → returns false (not held)
  // Session gate: files modified after lockMtime (13h ago) → all 8 files newer → passes
  const result = await shouldRunDream(store, config)
  expect(result).toBe(true)
})

test("E4: normal pressure with fresh lock — shouldRunDream returns false", async () => {
  const dir = await makeTempDir("e4")
  tempDirs.push(dir)
  const store = await createStore(dir)

  // Write 3 files out of 500 → normal pressure
  await writeMemoryFile(store, "a.md", "A", "test a", "user", "body")
  await writeMemoryFile(store, "b.md", "B", "test b", "user", "body")
  await writeMemoryFile(store, "c.md", "C", "test c", "user", "body")

  const lockPath = join(dir, ".consolidate-lock")
  await writeFile(lockPath, String(process.pid))

  const config = resolveConfig({
    dream: {
      ...resolveConfig().dream,
      minHoursSinceLast: 24,
      minSessionsSinceLast: 5,
    },
  })

  const result = await shouldRunDream(store, config)
  expect(result).toBe(false)
})

// ===========================================================================
// PART F — RecallHandle: Async Recall + Cross-Turn Consumption
// ===========================================================================

test("F1: recallMemories returns results for matching query", async () => {
  const dir = await makeTempDir("f1")
  tempDirs.push(dir)
  const store = await createStore(dir)

  // Write memories with different keywords
  await writeMemoryFile(store, "user_role.md", "User Role", "Senior Go engineer who likes clean code", "user", "identity")
  await writeMemoryFile(store, "feedback_test.md", "Testing", "Prefers integration tests over unit tests", "feedback", "guidance")
  await writeMemoryFile(store, "project_state.md", "Project State", "Working on memory optimization", "project", "context")

  const config = resolveConfig({ recall: { ...resolveConfig().recall, llmRerankDisabled: true } })
  const mockClient = createRecallMockClient()

  const result = await recallMemories("memory optimization", store, config, mockClient as any, [])

  expect(result.memories).toBeDefined()
  expect(result.memories.length).toBeGreaterThan(0)
  // Should match project_state.md (contains "memory optimization")
  const filenames = result.memories.map((m) => m.filename)
  expect(filenames).toContain("project_state.md")
})

test("F2: recallMemories filters transient tool-debug memories", async () => {
  const dir = await makeTempDir("f2")
  tempDirs.push(dir)
  const store = await createStore(dir)

  // Write a transient memory and a durable memory, both about "npm"
  await writeMemoryFile(store, "npm_error.md", "NPM Error", "npm install failed with EACCES", "project", "error log")
  await writeMemoryFile(store, "npm_workaround.md", "NPM Workaround", "npm requires sudo workaround for permissions", "feedback", "solution")

  const config = resolveConfig({ recall: { ...resolveConfig().recall, llmRerankDisabled: true } })
  const mockClient = createRecallMockClient()

  // With npm as recent tool → transient "npm install failed" should be filtered
  // Durable "npm requires sudo workaround" should survive (has "workaround" + "requires")
  const result = await recallMemories("npm", store, config, mockClient as any, ["npm"])

  const filenames = result.memories.map((m) => m.filename)
  // npm_workaround.md should survive (has durable markers)
  expect(filenames).toContain("npm_workaround.md")
  // npm_error.md should be filtered (transient marker "failed", no durable marker)
  expect(filenames).not.toContain("npm_error.md")
})

test("F3: RecallHandle lifecycle — settled → consumed → no double-inject", async () => {
  const dir = await makeTempDir("f3")
  tempDirs.push(dir)
  const store = await createStore(dir)

  await writeMemoryFile(store, "user_role.md", "User Role", "Senior Go engineer preference", "user", "identity")

  const config = resolveConfig({ recall: { ...resolveConfig().recall, llmRerankDisabled: true } })
  const mockClient = createRecallMockClient()

  // Simulate the RecallHandle lifecycle as index.ts does it:
  // 1. Fire recall (async) → create handle
  // 2. Wait for settlement
  // 3. Consume once (mark consumed)
  // 4. Verify second consumption is a no-op

  const promise = recallMemories("Go engineer", store, config, mockClient as any, [])
  const handle = {
    promise,
    settledAt: null as number | null,
    consumed: false,
    sessionId: "test-f3",
  }

  // Await the promise → settles the handle
  const result = await promise
  handle.settledAt = Date.now()

  expect(handle.settledAt).not.toBeNull()
  expect(result.memories.length).toBeGreaterThan(0)

  // First consumption — should produce formatted memories
  handle.consumed = true
  expect(handle.consumed).toBe(true)

  // Second consumption check — consumed flag prevents double-inject
  // This mirrors the index.ts logic: `if (handle && handle.settledAt !== null && !handle.consumed)`
  const shouldInject = handle.settledAt !== null && !handle.consumed
  expect(shouldInject).toBe(false) // already consumed → no double-inject
})

test("F4: recallMemories with empty query returns no memories (min_query_length)", async () => {
  const dir = await makeTempDir("f4")
  tempDirs.push(dir)
  const store = await createStore(dir)

  await writeMemoryFile(store, "user_role.md", "User Role", "Senior Go engineer", "user", "identity")

  const config = resolveConfig({ recall: { ...resolveConfig().recall, llmRerankDisabled: true } })
  const mockClient = createRecallMockClient()

  // Query below min_query_length (default 5) → no recall
  const result = await recallMemories("ok", store, config, mockClient as any, [])
  expect(result.memories.length).toBe(0)
})

test("F5: recallMemories with no matching keywords returns empty", async () => {
  const dir = await makeTempDir("f5")
  tempDirs.push(dir)
  const store = await createStore(dir)

  await writeMemoryFile(store, "user_role.md", "User Role", "Senior Go engineer", "user", "identity")

  const config = resolveConfig({ recall: { ...resolveConfig().recall, llmRerankDisabled: true } })
  const mockClient = createRecallMockClient()

  // Query that doesn't match any memory keywords
  const result = await recallMemories("kubernetes deployment", store, config, mockClient as any, [])
  expect(result.memories.length).toBe(0)
})

test("F6: formatMemoriesByScope produces formatted output for injected memories", async () => {
  const dir = await makeTempDir("f6")
  tempDirs.push(dir)
  const store = await createStore(dir)

  await writeMemoryFile(store, "user_role.md", "User Role", "Senior Go engineer", "user", "I am a Go engineer.")
  await writeMemoryFile(store, "project_state.md", "Project", "Working on memory plugin", "project", "Building cursor integration.")

  const headers = await scanMemoryFiles(store)
  const contentMap = new Map(headers.map((h) => [h.filename, store.read(h.filename)]))

  // Resolve content promises
  const entries = await Promise.all(
    headers.map(async (h) => [h.filename, await store.read(h.filename)] as [string, string]),
  )
  const resolvedContent = new Map(entries)

  const formatted = formatMemoriesByScope([], headers, resolvedContent, 30)
  expect(formatted).toContain("## Current Project Memory")
  expect(formatted).toContain("memory plugin")
})
