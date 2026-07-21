/**
 * memory-list.test.ts — v0.3.4 Phase 0 memory_list Tool Tests
 *
 * Tests the memory_list tool's v0.3.4 behavior:
 * - Default active-only (AC-6)
 * - includeArchived=true (AC-7) shows both partitions
 * - archivedOnly=true (AC-8) shows archive only
 * - Empty states
 *
 * See: docs/superpowers/specs/v0.3.4/04-archive-index.md §7, §9.1
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { FileSystemStore } from "../../src/store.js"
import { defineMemoryTools } from "../../src/tools.js"
import { resolveConfig } from "../../src/config.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string
let store: FileSystemStore
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tools: Record<string, { execute: (...args: any[]) => Promise<any> }>

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "memlist-test-"))
  store = new FileSystemStore(tmpDir, 200, 30)
  const config = resolveConfig()
  tools = defineMemoryTools(store, config)
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

/** Create a memory file with frontmatter (status optional). */
async function createMemory(
  filename: string,
  name: string,
  description: string,
  status?: "active" | "archived",
): Promise<void> {
  const lines = [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    "type: user",
    "scope: user",
    "confidence: inferred",
    "schema_version: 1",
  ]
  if (status) {
    lines.push(`status: ${status}`)
    if (status === "archived") {
      lines.push(`archivedAt: ${Date.now()}`)
    }
  }
  lines.push("---", "", "content body")
  await writeFile(join(tmpDir, filename), lines.join("\n"), "utf-8")
}

/** Call memory_list tool with optional args. */
async function listMemories(args: Record<string, unknown> = {}): Promise<string> {
  const result = await tools.memory_list.execute(args)
  return result.output
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("memory_list — default active-only (AC-6)", () => {
  test("shows only active memories by default", async () => {
    await createMemory("active.md", "Active", "An active memory")
    await createMemory("archived.md", "Archived", "An archived memory", "archived")

    const output = await listMemories()

    expect(output).toContain("Active Memories")
    expect(output).toContain("active.md")
    expect(output).not.toContain("archived.md")
  })

  test("shows empty state when no active memories", async () => {
    await createMemory("archived.md", "Archived", "An archived memory", "archived")

    const output = await listMemories()

    expect(output).toContain("No active memories found")
    expect(output).toContain("includeArchived=true")
  })

  test("shows empty state when no memories at all", async () => {
    const output = await listMemories()
    expect(output).toContain("No active memories found")
  })
})

describe("memory_list — includeArchived=true (AC-7)", () => {
  test("shows both active and archived", async () => {
    await createMemory("active.md", "Active", "An active memory")
    await createMemory("archived.md", "Archived", "An archived memory", "archived")

    const output = await listMemories({ includeArchived: true })

    expect(output).toContain("All Memories")
    expect(output).toContain("active.md")
    expect(output).toContain("archived.md")
  })

  test("shows count as sum of both", async () => {
    await createMemory("a1.md", "A1", "First active")
    await createMemory("a2.md", "A2", "Second active")
    await createMemory("ar1.md", "AR1", "First archived", "archived")

    const output = await listMemories({ includeArchived: true })

    // Should have 3 total entries
    expect(output).toContain("All Memories (3)")
  })
})

describe("memory_list — archivedOnly=true (AC-8)", () => {
  test("shows only archived memories", async () => {
    await createMemory("active.md", "Active", "An active memory")
    await createMemory("archived.md", "Archived", "An archived memory", "archived")

    const output = await listMemories({ archivedOnly: true })

    expect(output).toContain("Archived Memories")
    expect(output).toContain("archived.md")
    expect(output).not.toContain("active.md")
  })

  test("shows empty state when no archived memories", async () => {
    await createMemory("active.md", "Active", "An active memory")

    const output = await listMemories({ archivedOnly: true })

    expect(output).toContain("No archived memories found")
  })
})

describe("memory_list — memories without status field", () => {
  test("treats missing status as active", async () => {
    // Legacy files without status field should be treated as active
    await createMemory("legacy.md", "Legacy", "No status field")
    await createMemory("archived.md", "Archived", "Has archived status", "archived")

    const output = await listMemories()
    expect(output).toContain("legacy.md")
    expect(output).not.toContain("archived.md")
  })
})