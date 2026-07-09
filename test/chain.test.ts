/**
 * chain.test.ts — Data-layer chain validation for opencode-memory plugin.
 *
 * Tests the full pipeline: config → store → scan → prompt → staleness → truncation.
 * Uses Bun's built-in test runner.
 */

import { test, expect, beforeAll, afterAll } from "bun:test";
import { join } from "path";
import { mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const TEST_DIR = join(tmpdir(), "opencode-mem-test");
const CONFIG_PATH = join(TEST_DIR, "memory.config.json");

beforeAll(async () => {
  await mkdir(TEST_DIR, { recursive: true });
  // Write a minimal config file so loadConfig() can find it
  await writeFile(
    CONFIG_PATH,
    JSON.stringify(
      {
        enabled: true,
        storage: "filesystem",
        features: {
          recall: {
            agent: "explore",
            background: true,
            llm_rerank: true,
            max_candidates: 20,
            max_results: 5,
            max_tokens: 256,
            min_query_length: 5,
          },
          extraction: {
            category: "quick",
            min_tokens_to_init: 10000,
            min_tokens_between_update: 5000,
            max_section_length: 2000,
            max_total_tokens: 12000,
          },
          dream: {
            category: "deep",
            min_hours_since_last: 24,
            min_sessions_since_last: 5,
            lock_stale_timeout_ms: 3600000,
          },
          staleness: {
            warn_after_days: 1,
          },
        },
        entrypoint: {
          max_lines: 200,
          max_bytes: 25000,
        },
        scan: {
          max_files: 200,
          frontmatter_max_lines: 30,
        },
        models: {
          recall: null,
          extraction: null,
          dream: null,
        },
      },
      null,
      2,
    ),
  );
});

afterAll(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 1. Test config loading
// ---------------------------------------------------------------------------

test("loadConfig returns correct defaults and overrides", async () => {
  const { loadConfig } = await import("../src/config.js");
  const config = await loadConfig(CONFIG_PATH);

  expect(config.enabled).toBe(true);
  expect(config.recall.subagentType).toBe("explore");
  expect(config.extraction.category).toBe("quick");
  expect(config.dream.category).toBe("deep");
  expect(config.storage).toBe("filesystem");
  expect(config.recall.maxCandidates).toBe(20);
  expect(config.recall.maxResults).toBe(5);
  expect(config.recall.maxTokens).toBe(256);
  expect(config.recall.minQueryLength).toBe(5);
  expect(config.extraction.minTokensToInit).toBe(10000);
  expect(config.dream.minHoursSinceLast).toBe(24);
  expect(config.dream.enabled).toBe(true);
  expect(config.staleness.warnAfterDays).toBe(1);
  expect(config.entrypoint.maxLines).toBe(200);
  expect(config.entrypoint.maxBytes).toBe(25000);
  expect(config.scan.maxFiles).toBe(200);
  expect(config.models.recall).toBeNull();
});

// ---------------------------------------------------------------------------
// 2. Test store creation
// ---------------------------------------------------------------------------

test("2 createStore creates directory and returns store with correct methods", async () => {
  const { createStore } = await import("../src/store.js");
  const store = await createStore(TEST_DIR);

  expect(store.getDir()).toBe(TEST_DIR);

  const listResult = await store.list();
  expect(Array.isArray(listResult)).toBe(true);
  expect(listResult).toHaveLength(0);

  const index = await store.getIndex();
  expect(index).toBeNull();
});

// ---------------------------------------------------------------------------
// 3. Test write + read
// ---------------------------------------------------------------------------

test("3 write and read a memory file with frontmatter", async () => {
  const { createStore } = await import("../src/store.js");
  const store = await createStore(TEST_DIR);

  const content = `---
name: User Role
description: Senior engineer prefers terse responses
type: user
---

User is a senior Go engineer.`;

  await store.write("user_role.md", content);
  const readBack = await store.read("user_role.md");
  expect(readBack).toBe(content);
});

// ---------------------------------------------------------------------------
// 4. Test list after write
// ---------------------------------------------------------------------------

test("4 list returns correct header after write", async () => {
  const { createStore } = await import("../src/store.js");
  const store = await createStore(TEST_DIR);

  const headers = await store.list();
  expect(headers).toHaveLength(1);

  const h = headers[0];
  expect(h.filename).toBe("user_role.md");
  expect(h.description).toBe("Senior engineer prefers terse responses");
  expect(h.type).toBe("user");
});

// ---------------------------------------------------------------------------
// 5. Test scan + formatManifest
// ---------------------------------------------------------------------------

test("5 scanMemoryFiles and formatManifest produce correct output", async () => {
  const { createStore } = await import("../src/store.js");
  const { scanMemoryFiles, formatManifest } = await import("../src/scan.js");

  const store = await createStore(TEST_DIR);
  const headers = await scanMemoryFiles(store);
  expect(headers).toHaveLength(1);

  const manifest = formatManifest(headers);
  expect(manifest).toContain("user_role.md");
  expect(manifest).toContain("Senior engineer prefers terse responses");
  expect(manifest).toContain("[user]");
});

// ---------------------------------------------------------------------------
// 6. Test buildMemoryPrompt (empty index)
// ---------------------------------------------------------------------------

test("6 buildMemoryPrompt with empty MEMORY.md says empty", async () => {
  const { createStore } = await import("../src/store.js");
  const { loadConfig } = await import("../src/config.js");
  const { buildMemoryPrompt } = await import("../src/prompt.js");

  const store = await createStore(TEST_DIR);
  const config = await loadConfig(CONFIG_PATH);

  const prompt = await buildMemoryPrompt(store, config);

  expect(prompt).toContain("# Auto Memory");
  // The MEMORY.md section should say "empty" since we haven't written an index
  expect(prompt).toContain("MEMORY.md is currently empty");
  // The actual memory file user_role.md should NOT appear in the MEMORY.md section
  // (it exists on disk but MEMORY.md index hasn't been written yet)
  const memSection = prompt.split("## MEMORY.md")[1] ?? "";
  expect(memSection).not.toContain("user_role.md");
  expect(prompt).toContain("<types>");
  expect(prompt).toContain("<name>user</name>");
  expect(prompt).toContain("<name>feedback</name>");
  expect(prompt).toContain("<name>project</name>");
  expect(prompt).toContain("<name>reference</name>");
});

// ---------------------------------------------------------------------------
// 7. Test index write + prompt with index
// ---------------------------------------------------------------------------

test("7 updateIndex then buildMemoryPrompt includes index content", async () => {
  const { createStore } = await import("../src/store.js");
  const { loadConfig } = await import("../src/config.js");
  const { buildMemoryPrompt } = await import("../src/prompt.js");

  const store = await createStore(TEST_DIR);
  const config = await loadConfig(CONFIG_PATH);

  await store.updateIndex("- [User Role](user_role.md) — Senior engineer");
  const indexContent = await store.getIndex();
  expect(indexContent).toBe("- [User Role](user_role.md) — Senior engineer");

  const prompt = await buildMemoryPrompt(store, config);
  expect(prompt).toContain("- [User Role](user_role.md) — Senior engineer");
  // The prompt should NOT say "empty" anymore
  expect(prompt).not.toContain("MEMORY.md is currently empty");
});

// ---------------------------------------------------------------------------
// 8. Test staleness functions
// ---------------------------------------------------------------------------

test("8 memoryAgeDays, memoryAge, memoryFreshnessText, memoryFreshnessNote work correctly", async () => {
  const {
    memoryAgeDays,
    memoryAge,
    memoryFreshnessText,
    memoryFreshnessNote,
  } = await import("../src/staleness.js");

  const now = Date.now();
  expect(memoryAgeDays(now)).toBe(0);
  expect(memoryAge(now)).toBe("today");
  expect(memoryFreshnessText(now, 1)).toBe("");

  const fiveDaysAgo = Date.now() - 5 * 86_400_000;
  expect(memoryAgeDays(fiveDaysAgo)).toBe(5);
  expect(memoryAge(fiveDaysAgo)).toBe("5 days ago");
  const text = memoryFreshnessText(fiveDaysAgo, 1);
  expect(text).toContain("5 days old");
  expect(text).toContain("point-in-time");

  const note = memoryFreshnessNote(fiveDaysAgo, 1);
  expect(note).toContain("<system-reminder>");
  expect(note).toContain("</system-reminder>");
});

// ---------------------------------------------------------------------------
// 9. Test truncateEntrypoint
// ---------------------------------------------------------------------------

test("9 truncateEntrypoint handles under-limit and over-limit content", async () => {
  const { truncateEntrypoint } = await import("../src/prompt.js");

  // Under limit — no truncation
  const short = "line1\nline2\nline3";
  const result1 = truncateEntrypoint(short, 200, 25000);
  expect(result1.wasLineTruncated).toBe(false);
  expect(result1.wasByteTruncated).toBe(false);
  expect(result1.content).toBe(short);

  // Over line limit: 300 lines with maxLines=200
  const longLines = Array.from({ length: 300 }, (_, i) => `line ${i + 1}`).join("\n");
  const result2 = truncateEntrypoint(longLines, 200, 25000);
  expect(result2.wasLineTruncated).toBe(true);
  // Should have 200 original lines + 3 warning lines = 203
  const result2Lines = result2.content.split("\n");
  expect(result2Lines.length).toBeGreaterThanOrEqual(200);
  expect(result2Lines.length).toBeLessThanOrEqual(205);
  expect(result2.content).toContain("WARNING");
  expect(result2.content).toContain("MEMORY.md");
});

// ---------------------------------------------------------------------------
// 10. Cleanup — delete temp directory
// ---------------------------------------------------------------------------

test("10 cleanup removes temp directory", async () => {
  await rm(TEST_DIR, { recursive: true, force: true });

  // Verify it's gone
  const { access } = await import("fs/promises");
  let exists = true;
  try {
    await access(TEST_DIR);
  } catch {
    exists = false;
  }
  expect(exists).toBe(false);
});