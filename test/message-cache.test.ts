import { describe, test, expect, beforeEach, afterEach } from "vitest"
import { appendMessage, readMessages, getMessageCount } from "../src/message-cache.js"
import { mkdtemp, rm } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "msg-cache-"))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe("message cache", () => {
  test("appendMessage writes a JSONL line", async () => {
    await appendMessage(dir, "ses_1", { role: "user", content: "hello" })
    const msgs = await readMessages(dir, "ses_1")
    expect(msgs).toHaveLength(1)
    expect(msgs[0].role).toBe("user")
    expect(msgs[0].content).toBe("hello")
    expect(msgs[0].timestamp).toBeTruthy()
  })

  test("appendMessage appends to existing file", async () => {
    await appendMessage(dir, "ses_1", { role: "user", content: "first" })
    await appendMessage(dir, "ses_1", { role: "assistant", content: "second" })
    const msgs = await readMessages(dir, "ses_1")
    expect(msgs).toHaveLength(2)
    expect(msgs[0].content).toBe("first")
    expect(msgs[1].content).toBe("second")
  })

  test("readMessages with offset returns only new messages", async () => {
    for (let i = 0; i < 5; i++) {
      await appendMessage(dir, "ses_1", { role: "user", content: `msg${i}` })
    }
    const msgs = await readMessages(dir, "ses_1", 3)
    expect(msgs).toHaveLength(2)
    expect(msgs[0].content).toBe("msg3")
    expect(msgs[1].content).toBe("msg4")
  })

  test("readMessages returns empty for non-existent session", async () => {
    const msgs = await readMessages(dir, "nonexistent")
    expect(msgs).toEqual([])
  })

  test("getMessageCount returns correct count", async () => {
    for (let i = 0; i < 3; i++) {
      await appendMessage(dir, "ses_1", { role: "user", content: `msg${i}` })
    }
    const count = await getMessageCount(dir, "ses_1")
    expect(count).toBe(3)
  })
})
