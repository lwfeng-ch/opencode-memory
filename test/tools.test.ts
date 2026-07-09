/**
 * Tests for opencode-memory plugin tools
 *
 * Validates all 6 custom tools: memory_save, memory_list, memory_search,
 * memory_read, memory_append, memory_delete, plus error handling.
 */

import { test, expect, beforeAll, afterAll } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { mkdir, rm, readFile } from "fs/promises";
import { createStore } from "../src/store.js";
import { resolveConfig } from "../src/config.js";
import { defineMemoryTools } from "../src/tools.js";

const TEST_DIR = join(tmpdir(), "opencode-mem-tools-test-" + Date.now());
let store: Awaited<ReturnType<typeof createStore>>;
let tools: ReturnType<typeof defineMemoryTools>;
const ctx = {
  sessionID: "test-session",
  messageID: "test-msg",
  abort: new AbortController().signal,
};

beforeAll(async () => {
  await mkdir(TEST_DIR, { recursive: true });
  store = await createStore(TEST_DIR);
  const config = resolveConfig();
  tools = defineMemoryTools(store, config);
});

afterAll(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 1. memory_save — Create a memory file + update index
// ---------------------------------------------------------------------------
test("memory_save: saves a memory file and updates index", async () => {
  const result = await tools.memory_save.execute(
    {
      filename: "user_role.md",
      content: "User is a senior Go engineer.",
      name: "User Role",
      description: "Senior engineer prefers terse responses",
      type: "user",
    },
    ctx,
  );

  expect(result.output).toContain("Saved memory");

  // Verify file exists
  const exists = await store.exists("user_role.md");
  expect(exists).toBe(true);

  // Verify index has entry
  const index = await store.getIndex();
  expect(index).not.toBeNull();
  expect(index).toContain("user_role.md");
  expect(index).toContain("User Role");
});

// ---------------------------------------------------------------------------
// 2. memory_list — List all memories
// ---------------------------------------------------------------------------
test("memory_list: lists saved memories with metadata", async () => {
  const result = await tools.memory_list.execute({}, ctx);

  expect(result.output).toContain("user_role.md");
  expect(result.output).toContain("user");
  expect(result.output).toContain("Senior engineer");
});

// ---------------------------------------------------------------------------
// 3. memory_search — Keyword search
// ---------------------------------------------------------------------------
test("memory_search: finds matching memories by keyword", async () => {
  const result = await tools.memory_search.execute({ query: "engineer" }, ctx);

  expect(result.output).toContain("user_role.md");
  expect(result.output).toContain("Found");
  expect(result.output).toContain("match");
});

test("memory_search: returns 'No memories matching' for non-matching query", async () => {
  const result = await tools.memory_search.execute({ query: "zzz" }, ctx);

  expect(result.output).toContain("No memories matching");
  expect(result.output).toContain("zzz");
});

// ---------------------------------------------------------------------------
// 4. memory_read — Read full content of a memory file
// ---------------------------------------------------------------------------
test("memory_read: reads full content with frontmatter", async () => {
  const result = await tools.memory_read.execute({ filename: "user_role.md" }, ctx);

  expect(result.output).toContain("User is a senior Go engineer.");
  expect(result.output).toContain("name: User Role");
  expect(result.output).toContain("type: user");
});

test("memory_read: auto-appends .md extension", async () => {
  const result = await tools.memory_read.execute({ filename: "user_role" }, ctx);

  expect(result.output).toContain("User is a senior Go engineer.");
});

// ---------------------------------------------------------------------------
// 5. memory_append — Append to daily log
// ---------------------------------------------------------------------------
test("memory_append: appends entry to daily log", async () => {
  const result = await tools.memory_append.execute(
    { entry: "User prefers Rust over Go", category: "fact" },
    ctx,
  );

  expect(result.output).toContain("Logged to");

  // Verify the log file was created
  const today = new Date();
  const yyyy = String(today.getFullYear());
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const logPath = join(TEST_DIR, "logs", yyyy, mm, `${yyyy}-${mm}-${dd}.md`);

  const logContent = await readFile(logPath, "utf-8");
  expect(logContent).toContain("User prefers Rust over Go");
  expect(logContent).toContain("[fact]");
});

// ---------------------------------------------------------------------------
// 6. memory_delete — Delete a memory file + remove from index
// ---------------------------------------------------------------------------
test("memory_delete: deletes memory file and removes from index", async () => {
  const result = await tools.memory_delete.execute({ filename: "user_role.md" }, ctx);

  expect(result.output).toContain("Deleted");
  expect(result.output).toContain("user_role.md");

  // Verify file no longer exists
  const exists = await store.exists("user_role.md");
  expect(exists).toBe(false);

  // Verify index no longer contains entry
  const index = await store.getIndex();
  expect(index).not.toBeNull();
  expect(index).not.toContain("user_role.md");
});

// ---------------------------------------------------------------------------
// 7. Error handling
// ---------------------------------------------------------------------------
test("memory_save: missing required fields returns error", async () => {
  const result = await tools.memory_save.execute(
    { filename: "test.md", content: "test" }, // missing name, description, type
    ctx,
  );

  expect(result.output).toContain("Error");
  expect(result.output).toContain("required");
});

test("memory_save: invalid type returns error", async () => {
  const result = await tools.memory_save.execute(
    {
      filename: "bad_type.md",
      content: "test",
      name: "Bad Type",
      description: "Testing invalid type",
      type: "invalid_type_xyz",
    },
    ctx,
  );

  expect(result.output).toContain("Error");
  expect(result.output).toContain("invalid type");
});

test("memory_read: non-existent file returns not found", async () => {
  const result = await tools.memory_read.execute(
    { filename: "nonexistent_file.md" },
    ctx,
  );

  expect(result.output).toContain("not found");
});

test("memory_delete: non-existent file returns not found", async () => {
  const result = await tools.memory_delete.execute(
    { filename: "nonexistent_file.md" },
    ctx,
  );

  expect(result.output).toContain("not found");
});