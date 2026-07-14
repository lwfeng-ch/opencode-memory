import { describe, test, expect } from "vitest"
import { parseEntries, deleteEntry, FileSystemStore } from "../src/store.js"
import { mkdtemp, rm, writeFile } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"

async function withTmpDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "entry-"))
  try { return await fn(dir) } finally { await rm(dir, { recursive: true, force: true }) }
}

describe("parseEntries", () => {
  test("returns empty for no markers", () => {
    const content = "---\nname: test\n---\nplain content"
    expect(parseEntries(content)).toEqual([])
  })

  test("parses multiple entries", () => {
    const content = "---\nname: test\n---\n\n<!-- entry:id=1 -->\nfirst\n\n<!-- entry:id=2 -->\nsecond"
    const entries = parseEntries(content)
    expect(entries).toHaveLength(2)
    expect(entries[0].id).toBe(1)
    expect(entries[0].body).toBe("first")
    expect(entries[1].id).toBe(2)
    expect(entries[1].body).toBe("second")
  })

  test("parses single entry", () => {
    const content = "---\nname: test\n---\n\n<!-- entry:id=1 -->\nonly entry"
    const entries = parseEntries(content)
    expect(entries).toHaveLength(1)
    expect(entries[0].id).toBe(1)
    expect(entries[0].body).toBe("only entry")
  })
})

describe("deleteEntry", () => {
  test("removes specific entry, keeps others", async () => {
    await withTmpDir(async (dir) => {
      const store = new FileSystemStore(dir)
      const content = "---\nname: test\n---\n\n<!-- entry:id=1 -->\nfirst\n\n<!-- entry:id=2 -->\nsecond"
      await store.write("test.md", content)
      const result = await deleteEntry(store, "test.md", 1)
      expect(result.deletedFile).toBe(false)
      expect(result.remainingEntries).toBe(1)
      const updated = await store.read("test.md")
      expect(updated).toContain("second")
      expect(updated).not.toContain("first")
    })
  })

  test("deletes file when last entry removed", async () => {
    await withTmpDir(async (dir) => {
      const store = new FileSystemStore(dir)
      const content = "---\nname: test\n---\n\n<!-- entry:id=1 -->\nonly entry"
      await store.write("test.md", content)
      const result = await deleteEntry(store, "test.md", 1)
      expect(result.deletedFile).toBe(true)
      expect(await store.exists("test.md")).toBe(false)
    })
  })

  test("falls back to file delete for no markers", async () => {
    await withTmpDir(async (dir) => {
      const store = new FileSystemStore(dir)
      await store.write("test.md", "---\nname: test\n---\nplain content")
      const result = await deleteEntry(store, "test.md", 1)
      expect(result.deletedFile).toBe(true)
    })
  })

  test("throws when entryId not found", async () => {
    await withTmpDir(async (dir) => {
      const store = new FileSystemStore(dir)
      const content = "---\nname: test\n---\n\n<!-- entry:id=1 -->\nfirst\n\n<!-- entry:id=2 -->\nsecond"
      await store.write("test.md", content)
      await expect(deleteEntry(store, "test.md", 99)).rejects.toThrow("not found")
    })
  })
})
