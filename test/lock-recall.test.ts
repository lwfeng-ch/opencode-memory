/**
 * Tests for lock mechanism and two-stage recall pipeline.
 *
 * Part A — Lock tests: acquire, release, staleness, edge cases.
 * Part B — Recall tests: Stage 1 rule filter, Stage 2 LLM rerank, fallback.
 */

import { test, expect, beforeAll, afterAll } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { mkdir, rm, writeFile, utimes } from "fs/promises";
import { existsSync } from "fs";

import { acquireLock, releaseLock, getLockMtime, isLockHeld } from "../src/lock.js";
import { createStore } from "../src/store.js";
import { resolveConfig } from "../src/config.js";
import { recallMemories } from "../src/recall.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const TEST_DIR = join(tmpdir(), "opencode-mem-lock-recall-test-" + Date.now());
const LOCK_PATH = join(TEST_DIR, ".lock");
const MEMORY_DIR = join(TEST_DIR, "memories");

let store: Awaited<ReturnType<typeof createStore>>;

beforeAll(async () => {
  await mkdir(TEST_DIR, { recursive: true });
  await mkdir(MEMORY_DIR, { recursive: true });
  store = await createStore(MEMORY_DIR);
});

afterAll(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

// ===========================================================================
// Part A — Lock tests
// ===========================================================================

// ---------------------------------------------------------------------------
// 1. Acquire on fresh lock
// ---------------------------------------------------------------------------
test("acquireLock: returns true on fresh lock, file contains PID", async () => {
  const acquired = await acquireLock(LOCK_PATH, 3_600_000);
  expect(acquired).toBe(true);

  // Verify lock file exists
  const { readFile } = await import("fs/promises");
  const content = await readFile(LOCK_PATH, "utf-8");
  expect(content).toBe(String(process.pid));
});

// ---------------------------------------------------------------------------
// 2. getLockMtime
// ---------------------------------------------------------------------------
test("getLockMtime: returns mtime > 0 for existing lock", async () => {
  const mtime = await getLockMtime(LOCK_PATH);
  expect(typeof mtime).toBe("number");
  expect(mtime).toBeGreaterThan(0);
});

test("getLockMtime: returns 0 for non-existent path", async () => {
  const mtime = await getLockMtime(join(TEST_DIR, ".nonexistent"));
  expect(mtime).toBe(0);
});

// ---------------------------------------------------------------------------
// 3. isLockHeld on held lock
// ---------------------------------------------------------------------------
test("isLockHeld: returns true for lock held by current process", async () => {
  const held = await isLockHeld(LOCK_PATH, 3_600_000);
  expect(held).toBe(true);
});

// ---------------------------------------------------------------------------
// 4. releaseLock
// ---------------------------------------------------------------------------
test("releaseLock: deletes lock file and isLockHeld returns false", async () => {
  await releaseLock(LOCK_PATH);

  // Verify file is deleted
  expect(existsSync(LOCK_PATH)).toBe(false);

  // Verify isLockHeld returns false
  const held = await isLockHeld(LOCK_PATH, 3_600_000);
  expect(held).toBe(false);
});

// ---------------------------------------------------------------------------
// 5. releaseLock on non-existent
// ---------------------------------------------------------------------------
test("releaseLock: does not throw on non-existent lock file", async () => {
  // Should not throw (ENOENT is swallowed)
  await expect(releaseLock(LOCK_PATH)).resolves.toBeUndefined();
});

// ---------------------------------------------------------------------------
// 6. Stale lock handling
// ---------------------------------------------------------------------------
test("acquireLock: overwrites stale lock from dead process", async () => {
  // Create a lock file with a PID that is extremely unlikely to exist
  await writeFile(LOCK_PATH, "999999");

  // Set mtime to 2 hours ago (7200000 ms = 2 hours)
  const twoHoursAgo = new Date(Date.now() - 7_200_000);
  await utimes(LOCK_PATH, twoHoursAgo, twoHoursAgo);

  // isLockHeld should return false (stale)
  const held = await isLockHeld(LOCK_PATH, 3_600_000);
  expect(held).toBe(false);

  // acquireLock should succeed (overwrites stale lock)
  const acquired = await acquireLock(LOCK_PATH, 3_600_000);
  expect(acquired).toBe(true);

  // Verify the lock now contains our PID
  const { readFile } = await import("fs/promises");
  const content = await readFile(LOCK_PATH, "utf-8");
  expect(content).toBe(String(process.pid));

  // Cleanup
  await releaseLock(LOCK_PATH);
});

// ===========================================================================
// Part B — Recall tests
// ===========================================================================

// ---------------------------------------------------------------------------
// 7. Setup: Write 3 memory files for recall tests
// ---------------------------------------------------------------------------
test("setup: write memory files for recall tests", async () => {
  await store.write(
    "user_role.md",
    "---\nname: User Role\ndescription: Senior Go engineer\ntype: user\n---\nUser is a senior Go engineer.",
  );
  await store.write(
    "feedback_testing.md",
    "---\nname: Testing Feedback\ndescription: Always use real database not mocks\ntype: feedback\n---\nDon't mock database.",
  );
  await store.write(
    "project_deadline.md",
    "---\nname: Project Deadline\ndescription: Release deadline next Thursday\ntype: project\n---\nRelease on 2026-03-05.",
  );

  // Verify all 3 files exist
  expect(await store.exists("user_role.md")).toBe(true);
  expect(await store.exists("feedback_testing.md")).toBe(true);
  expect(await store.exists("project_deadline.md")).toBe(true);
});

// ---------------------------------------------------------------------------
// 8. Stage 1 rule filter (no LLM)
// ---------------------------------------------------------------------------
test("recallMemories Stage 1: rule filter finds matching memories", async () => {
  const config = resolveConfig();
  config.recall.llmRerankDisabled = true;

  const result = await recallMemories("database mock testing", store, config, {} as any);

  expect(result.memories.length).toBeGreaterThan(0);
  expect(result.llmUsed).toBe(false);
  expect(result.stage1Count).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// 9. Stage 1 with no matches
// ---------------------------------------------------------------------------
test("recallMemories Stage 1: no keyword matches returns empty", async () => {
  const config = resolveConfig();
  config.recall.llmRerankDisabled = true;

  // Rewrite memories with old mtime so recency bonus doesn't cause false matches.
  // recency = max(0, 3 - floor(ageDays / 7)). With age >= 21 days, recency = 0.
  // This way "zzznomatch" gets score 0 → no results.
  const oldMtime = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days ago
  for (const f of ["user_role.md", "feedback_testing.md", "project_deadline.md"]) {
    const content = await store.read(f);
    // Write with same content so the file is recreated (losing old mtime)
    await store.write(f, content);
    // Then touch mtime back via the filesystem
    const { utimes } = await import("fs/promises");
    const { join } = await import("path");
    await utimes(join(MEMORY_DIR, f), new Date(oldMtime), new Date(oldMtime));
  }

  const result = await recallMemories("zzznomatch", store, config, {} as any);

  expect(result.memories.length).toBe(0);
  expect(result.stage1Count).toBe(0);
  expect(result.llmUsed).toBe(false);

  // Restore fresh mtime for subsequent tests by re-writing
  for (const f of ["user_role.md", "feedback_testing.md", "project_deadline.md"]) {
    const content = await store.read(f);
    await store.write(f, content);
  }
});

// ---------------------------------------------------------------------------
// 10. Stage 2 LLM rerank fallback (LLM unavailable)
// ---------------------------------------------------------------------------
test("recallMemories Stage 2: falls back to Stage 1 when LLM unavailable", async () => {
  const config = resolveConfig();
  config.recall.llmRerankDisabled = false;

  const failingClient = {
    session: {
      create: async () => {
        throw new Error("LLM unavailable");
      },
      chat: async () => {
        throw new Error("should not reach");
      },
    },
  };

  const result = await recallMemories("database testing", store, config, failingClient as any);

  // Should have fallen back to Stage 1 results
  expect(result.llmUsed).toBe(false);
  expect(result.memories.length).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// 11. Stage 2 with mock LLM response
// ---------------------------------------------------------------------------
test("recallMemories Stage 2: uses LLM rerank to select memories", async () => {
  const config = resolveConfig();
  config.recall.llmRerankDisabled = false;

  const mockClient = {
    session: {
      create: async () => ({ id: "mock-session" }),
      chat: async () => ({
        content: '{"selected_memories": ["feedback_testing.md"]}',
      }),
    },
  };

  const result = await recallMemories("database testing mock", store, config, mockClient as any);

  expect(result.llmUsed).toBe(true);
  expect(result.memories.length).toBe(1);
  expect(result.memories[0].filename).toBe("feedback_testing.md");
});