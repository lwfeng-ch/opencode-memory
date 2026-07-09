/**
 * opencode-memory — Plugin entry point
 *
 * Ties together the entire memory pipeline: config loading, store creation,
 * system prompt injection, async recall prefetch, session extraction, dream
 * consolidation, and custom tool registration.
 *
 * All background tasks (recall, extraction, dream) are fire-and-forget —
 * they never block the main agent flow.
 */

import type { Plugin } from "@opencode-ai/plugin"
import { loadConfig } from "./config.js"
import type { MemoryPluginConfig } from "./config.js"
import { createStore } from "./store.js"
import type { MemoryStore } from "./store.js"
import { getMemoryDir, ensureMemoryDir, getUserMemoryDir } from "./paths.js"
import { buildMemoryPrompt, buildScopedMemoryPrompt } from "./prompt.js"
import { recallMemories, recallMemoriesMultiScope } from "./recall.js"
import type { ScopedRecallResult } from "./recall.js"
import { defineMemoryTools } from "./tools.js"
import { extractSessionMemory } from "./extraction.js"
import { shouldRunDream, runDreamConsolidation } from "./dream.js"
import { scanMemoryFiles, formatMemoriesByScope } from "./scan.js"

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export const MemoryPlugin: Plugin = async (input, options) => {
  // 1. Load config
  const config: MemoryPluginConfig = await loadConfig()
  if (!config.enabled) return {}

  // 2. Resolve memory directory
  const memoryDir = getMemoryDir(input.directory, input.worktree)
  await ensureMemoryDir(memoryDir)

  // 3. Create project store
  const store: MemoryStore = await createStore(memoryDir, {
    maxFiles: config.scan.maxFiles,
    frontmatterMaxLines: config.scan.frontmatterMaxLines,
  })

  // 3b. Create user store (cross-project) if scope enabled
  let userStore: MemoryStore | undefined
  if (config.scope.userScopeEnabled) {
    const userMemoryDir = getUserMemoryDir()
    await ensureMemoryDir(userMemoryDir)
    userStore = await createStore(userMemoryDir, {
      maxFiles: config.scan.maxFiles,
      frontmatterMaxLines: config.scan.frontmatterMaxLines,
    })
  }

  // 4. Track recall results per session for injection (bounded to avoid leaks)
  const sessionRecallCache = new Map<string, ScopedRecallResult>()
  const MAX_RECALL_CACHE_SIZE = 100

  function setRecallCache(sessionID: string, result: ScopedRecallResult): void {
    if (sessionRecallCache.size >= MAX_RECALL_CACHE_SIZE && !sessionRecallCache.has(sessionID)) {
      // Map preserves insertion order; evict oldest entry (LRU fallback)
      const oldestKey = sessionRecallCache.keys().next().value as string | undefined
      if (oldestKey !== undefined) {
        sessionRecallCache.delete(oldestKey)
      }
    }
    sessionRecallCache.set(sessionID, result)
  }

  // 5. Track if extraction already ran for a session
  const extractedSessions = new Set<string>()

  return {
    // -----------------------------------------------------------------------
    // System prompt injection (no model call, pure file read)
    // -----------------------------------------------------------------------
    "experimental.chat.system.transform": async (input, output) => {
      let prompt: string | null
      if (userStore) {
        prompt = await buildScopedMemoryPrompt(userStore, store, config)
      } else {
        prompt = await buildMemoryPrompt(store, config)
      }
      if (prompt) {
        output.system.push(prompt)
      }

      // Also inject recalled memories if available for this session
      const recallResult = sessionRecallCache.get(input.sessionID)
      if (
        recallResult &&
        (recallResult.userMemories.length > 0 ||
          recallResult.projectMemories.length > 0)
      ) {
        const allMemories = [
          ...recallResult.userMemories,
          ...recallResult.projectMemories,
        ]
        const contentMap = new Map(
          allMemories.map((m) => [m.filename, m.content]),
        )

        const [userHeaders, projectHeaders] = await Promise.all([
          userStore ? scanMemoryFiles(userStore) : Promise.resolve([]),
          scanMemoryFiles(store),
        ])

        const selectedUserHeaders = userHeaders.filter((h) =>
          recallResult.userMemories.some((m) => m.filename === h.filename),
        )
        const selectedProjectHeaders = projectHeaders.filter((h) =>
          recallResult.projectMemories.some((m) => m.filename === h.filename),
        )

        const formatted = formatMemoriesByScope(
          selectedUserHeaders,
          selectedProjectHeaders,
          contentMap,
          config.staleness.warnAfterDays,
        )
        if (formatted) {
          output.system.push(formatted)
        }
      }
    },

    // -----------------------------------------------------------------------
    // Recall: async prefetch on user message (non-blocking)
    // -----------------------------------------------------------------------
    "chat.message": async (input, output) => {
      // Skip if recall is disabled
      if (!config.recall.enabled) return

      // Extract user query from the message
      const query = extractQueryFromMessage(output.message)
      if (!query || query.length < config.recall.minQueryLength) return

      // Need a client to call LLM for recall — skip if unavailable
      const client = input.client
      if (!client) return

      // Fire recall in background — do NOT await (async prefetch)
      if (config.recall.background) {
        if (userStore) {
          void recallMemoriesMultiScope(query, userStore, store, config, client)
            .then((result) => {
              setRecallCache(input.sessionID, result)
            })
            .catch(() => {
              /* Silent failure — recall is best-effort */
            })
        } else {
          void recallMemories(query, store, config, client)
            .then((result) => {
              setRecallCache(input.sessionID, {
                ...result,
                userMemories: [],
                projectMemories: result.memories,
              })
            })
            .catch(() => {
              /* Silent failure — recall is best-effort */
            })
        }
      } else {
        if (userStore) {
          const result = await recallMemoriesMultiScope(query, userStore, store, config, client)
          setRecallCache(input.sessionID, result)
        } else {
          const result = await recallMemories(query, store, config, client)
          setRecallCache(input.sessionID, {
            ...result,
            userMemories: [],
            projectMemories: result.memories,
          })
        }
      }
    },

    // -----------------------------------------------------------------------
    // Session events: extraction + dream
    // -----------------------------------------------------------------------
    event: async ({ event }) => {
      // Extraction on session idle
      if (event.type === "session.idle" && config.extraction.enabled) {
        const sessionId = event.properties?.id
        if (!sessionId || extractedSessions.has(sessionId)) return

        // Check if main agent already wrote memories this session
        // (cooperative, not competitive)
        // Approximate: check if any memory file was modified in the last 5 minutes
        const headers = await scanMemoryFiles(store)
        const fiveMinAgo = Date.now() - 300_000
        const hasRecentWrites = headers.some((h) => h.mtimeMs > fiveMinAgo)

        if (!hasRecentWrites) {
          extractedSessions.add(sessionId)
          const client = input.client
          if (client) {
            void extractSessionMemory(sessionId, store, config, client).catch(() => {
              /* best-effort */
            })
          }
        }
      }

      // Dream consolidation — check gates on session idle
      if (event.type === "session.idle" && config.dream.enabled) {
        const shouldRun = await shouldRunDream(store, config)
        if (shouldRun) {
          const client = input.client
          if (client) {
            void runDreamConsolidation(store, config, client).catch(() => {
              /* best-effort */
            })
          }
        }
      }
    },

    // -----------------------------------------------------------------------
    // Custom tools for the main agent
    // -----------------------------------------------------------------------
    tool: defineMemoryTools(store, config, userStore),
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract text query from a user message.
 *
 * Handles multiple message shapes:
 * - Plain string
 * - Object with `.content` (string or array of content parts)
 * - Any other shape returns null
 */
function extractQueryFromMessage(message: unknown): string | null {
  if (!message) return null
  if (typeof message === "string") return message

  const msg = message as Record<string, unknown>
  if (typeof msg.content === "string") return msg.content

  if (Array.isArray(msg.content)) {
    const textPart = msg.content.find(
      (p: unknown) =>
        typeof p === "object" &&
        p !== null &&
        (p as Record<string, unknown>).type === "text",
    )
    if (textPart) {
      const text = (textPart as Record<string, unknown>).text
      if (typeof text === "string") return text
    }
  }

  return null
}

export default MemoryPlugin