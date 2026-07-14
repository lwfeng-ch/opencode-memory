/**
 * opencode-memory — Plugin entry point
 *
 * Agent Memory Infrastructure — 6-layer architecture:
 *   Observability → Semantic → Fact → Processing → Trigger → Adapter
 *
 * Data flow on session.idle:
 *   1. captureSession() — mandatory, zero LLM, writes immutable fact record
 *   2. extractSessionMemory() — optional, LLM, fact→semantic transformation
 *   3. runDreamConsolidation() — optional, LLM, gated, staging→promotion
 *
 * All background tasks are fire-and-forget with visible error logging.
 * Failures update state.json for observability.
 */

import type { Plugin } from "@opencode-ai/plugin"
import { join } from "path"
import { loadConfig } from "./config.js"
import type { MemoryPluginConfig, AgentSessionCreateOptions } from "./config.js"
import { createStore } from "./store.js"
import type { MemoryStore } from "./store.js"
import { getMemoryDir, ensureMemoryDir, getUserMemoryDir } from "./paths.js"
import { buildMemoryPrompt, buildScopedMemoryPrompt } from "./prompt.js"
import { recallMemories, recallMemoriesMultiScope } from "./recall.js"
import type { ScopedRecallResult, RecallHandle } from "./recall.js"
import { defineMemoryTools } from "./tools.js"
import { extractSessionMemory } from "./extraction.js"
import { shouldRunDream, runDreamConsolidation } from "./dream.js"
import { scanMemoryFiles, formatMemoriesByScope } from "./scan.js"
import { runMigrationIfNeeded } from "./migration.js"
import { createRuntimeAdapter } from "./adapter.js"
import type { RuntimeAdapter } from "./adapter.js"
import { captureSession } from "./capture.js"
import type { CaptureContext } from "./capture.js"
import { updateState, recordEvent } from "./state.js"
import { initLogger, error as logError } from "./log.js"

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export const MemoryPlugin: Plugin = async (input) => {
  // 1. Load config
  const config: MemoryPluginConfig = await loadConfig()
  if (!config.enabled) return {}

  // 2. Resolve memory directory
  const memoryDir = await getMemoryDir(input.directory, input.worktree)
  await ensureMemoryDir(memoryDir)

  // 2a. Initialize logger — route [memory:*] output to file, keep terminal clean
  initLogger(join(memoryDir, "logs", "memory.log"), config.logging)

  // 2b. Run migration if needed (v1 → v2 schema)
  await runMigrationIfNeeded(memoryDir)

  // 2c. State path for pipeline observability
  const statePath = join(memoryDir, "state.json")

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

  // 4. Create runtime adapter (replaces old inline agentClient)
  const adapter: RuntimeAdapter = createRuntimeAdapter(input.client, {
    workspaceDir: input.directory,
  })

  // 4b. Adapter self-check (non-blocking, non-fatal)
  void adapter.healthCheck().then((result) => {
    void updateState(statePath, (s) => {
      s.adapter_status.session_create = result.sessionCreate
      s.adapter_status.session_messages = result.sessionMessages
      s.adapter_status.session_prompt = result.sessionPrompt
      s.adapter_status.last_check = new Date().toISOString()
      s.adapter_status.errors = result.errors
    })
    if (!result.sessionCreate) {
      logError("memory:adapter", "self-check failed: session.create not working")
    }
  }).catch((err) => {
      logError("memory:adapter", `self-check error: ${err instanceof Error ? err.message : String(err)}`)
  })

  // 5. Transitional client for recall.ts (still uses session.chat, not session.prompt)
  // This will be removed once recall.ts is updated to use RuntimeAdapter
  const sdkClient = input.client
  const sessionMeta = new Map<string, { agent?: string; model?: string }>()
  const MAX_SESSION_META = 50
  const recallClient = {
    session: {
      async create(opts: AgentSessionCreateOptions): Promise<{ id: string }> {
        const result = await sdkClient.session.create({} as never) as { data?: { id?: string }; error?: unknown; response?: Response }
        if (result.error) {
          const resp = result.response
          const status = resp ? `${resp.status} ${resp.statusText ?? ""}`.trim() : ""
          throw new Error(`session.create failed: ${status} ${JSON.stringify(result.error).slice(0, 300)}`.trim())
        }
        const id = result?.data?.id
        if (!id) throw new Error("Failed to create session")
        if (sessionMeta.size >= MAX_SESSION_META) {
          const oldestKey = sessionMeta.keys().next().value as string | undefined
          if (oldestKey !== undefined) sessionMeta.delete(oldestKey)
        }
        sessionMeta.set(id, { agent: opts.agent, model: opts.model })
        return { id }
      },
      async chat(id: string, opts: Record<string, unknown>): Promise<unknown> {
        const meta = sessionMeta.get(id)
        const text = (opts.message as string) ?? (opts.prompt as string) ?? ""
        // Build body — only include agent/model when set
        const body: {
          parts: Array<{ type: string; text: string }>
          agent?: string
          model?: { providerID: string; modelID: string }
        } = {
          parts: [{ type: "text", text }],
        }
        if (meta?.agent) body.agent = meta.agent
        if (meta?.model) body.model = { providerID: "", modelID: meta.model }
        const result = await sdkClient.session.prompt({
          path: { id },
          body,
        } as never) as { data?: unknown; error?: unknown; response?: Response }
        if (result.error) {
          const resp = result.response
          const status = resp ? `${resp.status} ${resp.statusText ?? ""}`.trim() : ""
          throw new Error(`session.prompt failed: ${status} ${JSON.stringify(result.error).slice(0, 300)}`.trim())
        }
        return result?.data
      },
      async messages(id: string): Promise<unknown[]> {
        const result = await sdkClient.session.messages({
          path: { id },
        } as never) as { data?: Array<{
          info: { role?: string }
          parts: Array<{ type: string; text?: string }>
        }>; error?: unknown; response?: Response }
        if (result.error) {
          const resp = result.response
          const status = resp ? `${resp.status} ${resp.statusText ?? ""}`.trim() : ""
          throw new Error(`session.messages failed: ${status} ${JSON.stringify(result.error).slice(0, 300)}`.trim())
        }
        const data = result?.data
        if (!data) return []
        return data.map((m) => ({
          role: m.info?.role,
          content: m.parts
            ?.filter((p) => p.type === "text")
            .map((p) => p.text ?? "")
            .join("\n") ?? "",
        }))
      },
    },
  }

  // 6. Recall cache (bounded) — for already-consumed results
  const sessionRecallCache = new Map<string, ScopedRecallResult>()
  const MAX_RECALL_CACHE_SIZE = 100

  // Pending recall handle — tracks async recall for cross-turn injection
  let pendingRecall: RecallHandle | undefined

  function setRecallCache(sessionID: string, result: ScopedRecallResult): void {
    if (sessionRecallCache.size >= MAX_RECALL_CACHE_SIZE && !sessionRecallCache.has(sessionID)) {
      const oldestKey = sessionRecallCache.keys().next().value as string | undefined
      if (oldestKey !== undefined) sessionRecallCache.delete(oldestKey)
    }
    sessionRecallCache.set(sessionID, result)
  }

  // 7. Session tracking for Fact Layer capture
  const sessionMessageCount = new Map<string, number>()
  const sessionToolCount = new Map<string, number>()
  const sessionToolEvents = new Map<string, Array<{ type: string; name: string; success: boolean; durationMs: number }>>()
  const sessionFirstMessage = new Map<string, string>()
  const sessionRecentTools = new Map<string, string[]>()
  const MAX_RECENT_TOOLS = 10

  return {
    // -----------------------------------------------------------------------
    // System prompt injection (no model call, pure file read)
    // -----------------------------------------------------------------------
    "experimental.chat.system.transform": async (input, output) => {
      void recordEvent(statePath, "experimental.chat.system.transform").catch(() => {})

      let prompt: string | null
      if (userStore) {
        prompt = await buildScopedMemoryPrompt(userStore, store, config)
      } else {
        prompt = await buildMemoryPrompt(store, config)
      }
      if (prompt) {
        output.system.push(prompt)
      }

      // Inject recalled memories — check pendingRecall first, then cache
      const sessionID = input.sessionID
      if (!sessionID) return

      // 1. Check pending recall (async handle from chat.message)
      const handle = pendingRecall
      if (handle && handle.settledAt !== null && !handle.consumed) {
        handle.consumed = true
        pendingRecall = undefined
        try {
          const result = await handle.promise // already settled — returns immediately
          setRecallCache(sessionID, result)
          if (result.userMemories.length > 0 || result.projectMemories.length > 0) {
            const allMemories = [...result.userMemories, ...result.projectMemories]
            const contentMap = new Map(allMemories.map((m) => [m.filename, m.content]))
            const [userHeaders, projectHeaders] = await Promise.all([
              userStore ? scanMemoryFiles(userStore) : Promise.resolve([]),
              scanMemoryFiles(store),
            ])
            const selectedUserHeaders = userHeaders.filter((h) =>
              result.userMemories.some((m) => m.filename === h.filename))
            const selectedProjectHeaders = projectHeaders.filter((h) =>
              result.projectMemories.some((m) => m.filename === h.filename))
            const formatted = formatMemoriesByScope(
              selectedUserHeaders, selectedProjectHeaders, contentMap,
              config.staleness.warnAfterDays)
            if (formatted) output.system.push(formatted)
          }
        } catch {
          // recall failed — silent
        }
        return
      }

      // 2. Check cached recall (already consumed in a previous turn)
      const recallResult = sessionRecallCache.get(sessionID)
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
    "chat.message": async (msgInput, output) => {
      void recordEvent(statePath, "chat.message").catch(() => {})

      // Track message count for Fact Layer
      const sid = msgInput.sessionID
      sessionMessageCount.set(sid, (sessionMessageCount.get(sid) ?? 0) + 1)
      if (!sessionFirstMessage.has(sid)) {
        sessionFirstMessage.set(sid, new Date().toISOString())
      }
      if (!sessionToolEvents.has(sid)) {
        sessionToolEvents.set(sid, [])
      }

      // Skip if recall is disabled
      if (!config.recall.enabled) return

      // Extract user query from the message
      const query = extractQueryFromMessage(output.message)
      if (!query || query.length < config.recall.minQueryLength) return

      // Fire recall — create RecallHandle (never await in background mode)
      const recentTools = sessionRecentTools.get(sid) ?? []
      const recallPromise = userStore
        ? recallMemoriesMultiScope(query, userStore, store, config, recallClient, recentTools)
        : recallMemories(query, store, config, recallClient, recentTools).then((r) => ({
            ...r,
            userMemories: [],
            projectMemories: r.memories,
          }))

      if (config.recall.background) {
        const handle: RecallHandle = {
          promise: recallPromise,
          settledAt: null,
          consumed: false,
          sessionId: sid,
        }
        void recallPromise
          .then(() => { handle.settledAt = Date.now() })
          .catch(() => { handle.settledAt = Date.now() })
        pendingRecall = handle
      } else {
        const result = await recallPromise
        setRecallCache(sid, result)
      }
    },

    // -----------------------------------------------------------------------
    // Tool event tracking (Fact Layer — tool call counters)
    // -----------------------------------------------------------------------
    "tool.execute.after": async (toolInput) => {
      void recordEvent(statePath, "tool.execute.after").catch(() => {})

      const sid = toolInput.sessionID
      sessionToolCount.set(sid, (sessionToolCount.get(sid) ?? 0) + 1)
      const events = sessionToolEvents.get(sid) ?? []
      events.push({
        type: "tool_call",
        name: toolInput.tool,
        success: true,
        durationMs: 0,
      })
      sessionToolEvents.set(sid, events)

      // Track recent tool names for transient memory filtering
      const tools = sessionRecentTools.get(sid) ?? []
      tools.push(toolInput.tool)
      if (tools.length > MAX_RECENT_TOOLS) tools.shift()
      sessionRecentTools.set(sid, tools)
    },

    // -----------------------------------------------------------------------
    // Session events: capture → extraction → dream
    // -----------------------------------------------------------------------
    event: async ({ event }) => {
      void recordEvent(statePath, "event").catch(() => {})

      if (event.type !== "session.idle") return

      const sessionId = event.properties?.sessionID
      if (!sessionId) return

      // --- Phase 1: Capture (mandatory, zero LLM) ---
      const captureCtx: CaptureContext = {
        sessionId,
        adapter,
        memoryDir,
        statePath,
        messageCount: sessionMessageCount.get(sessionId) ?? 0,
        toolCallCount: sessionToolCount.get(sessionId) ?? 0,
        toolEvents: sessionToolEvents.get(sessionId) ?? [],
        firstMessageAt: sessionFirstMessage.get(sessionId) ?? null,
      }
      // captureSession never throws (all errors caught internally)
      await captureSession(captureCtx)

      // --- Phase 2: Extraction (optional, LLM, cursor-based) ---
      if (config.extraction.enabled) {
        // Check if main agent already wrote memories (cooperative)
        const headers = await scanMemoryFiles(store)
        const fiveMinAgo = Date.now() - 300_000
        const hasRecentWrites = headers.some((h) => h.mtimeMs > fiveMinAgo)

        if (!hasRecentWrites) {
          void extractSessionMemory(sessionId, memoryDir, store, config, adapter, statePath)
            .catch((err) => {
              logError("memory:extraction", `session=${sessionId} error=${err instanceof Error ? err.message : String(err)}`)
            })
        }
      }

      // --- Phase 3: Dream (optional, LLM, gated) ---
      if (config.dream.enabled) {
        const shouldRun = await shouldRunDream(store, config, statePath)
        if (shouldRun) {
          void runDreamConsolidation(store, config, adapter)
            .catch((err) => {
              logError("memory:dream", `error=${err instanceof Error ? err.message : String(err)}`)
            })
        }
      }
    },

    // -----------------------------------------------------------------------
    // Custom tools for the main agent (9 tools)
    // -----------------------------------------------------------------------
    tool: defineMemoryTools(store, config, userStore, statePath),
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
