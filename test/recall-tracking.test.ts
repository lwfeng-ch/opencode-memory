import { describe, test, expect, beforeEach, afterEach } from "vitest"
import { FileSystemStore } from "../src/store.js"
import { mkdtemp, rm } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"

let dir: string
let store: FileSystemStore

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "recall-track-"))
  store = new FileSystemStore(dir)
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe("recall tracking", () => {
  test("touch updates lastRecalledAt and increments recallCount", async () => {
    await store.write("test.md", "---\nname: Test\ndescription: test memory\ntype: project\n---\nbody")
    await store.touch("test.md")
    const headers = await store.list()
    const h = headers.find((m) => m.filename === "test.md")
    expect(h?.recallCount).toBe(1)
    expect(h?.lastRecalledAt).toBeTruthy()
  })

  test("touch increments count on subsequent calls", async () => {
    await store.write("test.md", "---\nname: Test\ndescription: test\ntype: project\n---\nbody")
    await store.touch("test.md")
    await store.touch("test.md")
    const headers = await store.list()
    const h = headers.find((m) => m.filename === "test.md")
    expect(h?.recallCount).toBe(2)
  })

  test("touch on non-existent file is silent", async () => {
    await store.touch("nonexistent.md")
    // should not throw
  })

  test("MemoryHeader has recallCount and lastRecalledAt fields", async () => {
    await store.write("test.md", "---\nname: Test\ntype: project\n---\nbody")
    const headers = await store.list()
    const h = headers[0]
    expect(h).toHaveProperty("recallCount")
    expect(h).toHaveProperty("lastRecalledAt")
  })
})
