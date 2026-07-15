/**
 * opencode-memory — Message Fact Cache
 *
 * Append-only JSONL cache of session messages, written incrementally
 * during chat.message hooks. Decouples extraction from SDK API calls
 * and enables offline analysis + replay.
 *
 * File: fact/messages/<sessionId>.jsonl
 * Each line: {"timestamp":"...","role":"...","content":"...","hash":"...","tokens":N}
 */

import { appendFile, mkdir, readFile } from "fs/promises"
import { dirname } from "path"
import { createHash } from "crypto"
import { getFactRootDir } from "./paths.js"
import { join } from "path"

export interface CachedMessage {
  timestamp: string
  role: string
  content: string
  hash: string
  tokens: number
}

function getMessagesPath(memoryDir: string, sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, "-")
  return join(getFactRootDir(memoryDir), "messages", `${safe}.jsonl`)
}

export async function appendMessage(
  memoryDir: string,
  sessionId: string,
  message: { role: string; content: string },
): Promise<void> {
  const filePath = getMessagesPath(memoryDir, sessionId)
  const entry: CachedMessage = {
    timestamp: new Date().toISOString(),
    role: message.role,
    content: message.content,
    hash: createHash("sha256").update(message.content).digest("hex").slice(0, 16),
    tokens: Math.ceil(message.content.length / 4),
  }
  const line = JSON.stringify(entry) + "\n"
  try {
    await mkdir(dirname(filePath), { recursive: true })
    await appendFile(filePath, line, { encoding: "utf-8" })
  } catch {
    // Silent — cache is best-effort
  }
}

export async function readMessages(
  memoryDir: string,
  sessionId: string,
  offset: number = 0,
): Promise<CachedMessage[]> {
  const filePath = getMessagesPath(memoryDir, sessionId)
  let content: string
  try {
    content = await readFile(filePath, { encoding: "utf-8" })
  } catch {
    return []
  }

  const lines = content.split("\n").filter((l) => l.trim())
  const messages: CachedMessage[] = []
  for (let i = offset; i < lines.length; i++) {
    try {
      messages.push(JSON.parse(lines[i]) as CachedMessage)
    } catch {
      // skip unparseable lines
    }
  }
  return messages
}

export async function getMessageCount(
  memoryDir: string,
  sessionId: string,
): Promise<number> {
  const filePath = getMessagesPath(memoryDir, sessionId)
  let content: string
  try {
    content = await readFile(filePath, { encoding: "utf-8" })
  } catch {
    return 0
  }
  return content.split("\n").filter((l) => l.trim()).length
}
