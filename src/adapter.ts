/**
 * opencode-memory — Runtime Adapter
 *
 * Wraps the OpenCode SDK client into a clean, capability-aware interface
 * for session access, git info, workspace info, and self-check.
 *
 * Design principle: the adapter is the ONLY place that knows about SDK
 * internals. Everything else in the plugin talks to RuntimeAdapter,
 * so SDK changes (renamed methods, new response shapes) are localized
 * here.
 *
 * See: docs/specs/2026-07-10-memory-infrastructure-design.md § Adapter Layer
 */

import { execFile } from "child_process"
import { promisify } from "util"
import type { AgentSessionCreateOptions } from "./config.js"

const execFileAsync = promisify(execFile)

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

/** Git state snapshot at a point in time. */
export interface GitSnapshot {
  branch: string
  head: string
  changedFiles: Array<{ path: string; changes: string }>
}

/** Runtime feature flags — lets the plugin adapt to different OpenCode versions. */
export interface RuntimeCapabilities {
  sessionCreate: boolean
  messageRead: boolean
  eventStream: boolean
  backgroundTask: boolean
  toolHook: boolean
}

/** Result of the adapter self-check (run on plugin init). */
export interface AdapterHealthResult {
  sessionCreate: boolean
  sessionMessages: boolean
  sessionPrompt: "working" | "untested" | "failed"
  errors: string[]
}

/** Clean runtime interface — the only abstraction the rest of the plugin uses. */
export interface RuntimeAdapter {
  session: {
    create(opts: AgentSessionCreateOptions): Promise<{ id: string }>
    prompt(id: string, message: string, opts?: { agent?: string; model?: string }): Promise<unknown>
    messages(id: string, limit?: number): Promise<unknown[]>
  }
  workspace: {
    current(): Promise<string>
  }
  git: {
    snapshot(): Promise<GitSnapshot>
  }
  capabilities: RuntimeCapabilities
  healthCheck(): Promise<AdapterHealthResult>
}

// ---------------------------------------------------------------------------
// Internal types — SDK shape (NOT exported; avoids coupling to SDK types)
// ---------------------------------------------------------------------------

/**
 * Minimal SDK session API shape.
 *
 * Methods accept `never` so call sites must use `as never` casts on options
 * objects — the same pattern as the original inline adapter in index.ts.
 * This keeps TypeScript honest: we are NOT type-checking SDK arguments.
 */
type SdkSessionMethod = (opts: never) => Promise<unknown>

interface SdkClientShape {
  session: {
    create: SdkSessionMethod
    prompt: SdkSessionMethod
    messages: SdkSessionMethod
  }
}

/**
 * hey-api response envelope (ThrowOnError = false).
 *
 * The SDK returns `{ data, error, request, response }` — errors don't throw,
 * they come back as `error`. We must check both `data` and `error`.
 */
interface SdkResponse<TData = unknown> {
  data?: TData
  error?: unknown
  response?: Response
}

/**
 * Format an SDK error for logging.
 *
 * hey-api errors can be: BadRequestError, NotFoundError, or other shapes.
 * We extract the most useful information without assuming a specific type.
 */
function formatSdkError(error: unknown, response?: Response): string {
  const status = response ? `${response.status} ${response.statusText ?? ""}`.trim() : ""
  let detail: string
  if (error instanceof Error) {
    detail = error.message
  } else if (typeof error === "string") {
    detail = error
  } else if (error && typeof error === "object") {
    // hey-api error objects typically have { message?: string, ... }
    const errObj = error as Record<string, unknown>
    detail = typeof errObj.message === "string" ? errObj.message : JSON.stringify(error).slice(0, 300)
  } else {
    detail = String(error)
  }
  return status ? `${status}: ${detail}` : detail
}

/**
 * Check a hey-api SdkResponse and throw if it contains an error.
 *
 * Handles null/undefined results defensively (e.g., network timeouts that
 * resolve instead of rejecting).
 *
 * @returns `result.data` (may be undefined if the response had no data)
 * @throws  Error if `result.error` is truthy
 */
function unwrapSdkResponse<T>(result: SdkResponse<T> | undefined | null): T | undefined {
  if (!result) return undefined
  if (result.error) {
    throw new Error(formatSdkError(result.error, result.response))
  }
  return result.data
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a RuntimeAdapter wrapping an OpenCode SDK client.
 *
 * The SDK client (`input.client` from PluginInput) is passed as `unknown`
 * to avoid coupling this module to `@opencode-ai/plugin` type definitions.
 * The adapter casts it to the minimal shape it needs.
 *
 * @param sdkClient - `input.client` from the plugin's PluginInput (OpencodeClient)
 * @param options   - Optional configuration; `workspaceDir` overrides `process.cwd()`
 *                    for git commands and `workspace.current()`.
 */
export function createRuntimeAdapter(
  sdkClient: unknown,
  options?: { workspaceDir?: string },
): RuntimeAdapter {
  const client = sdkClient as SdkClientShape

  // Session metadata (agent/model per session) with LRU eviction.
  // Same pattern as the original inline adapter in index.ts.
  const sessionMeta = new Map<string, { agent?: string; model?: string }>()
  const MAX_SESSION_META = 50
  const workspaceDir = options?.workspaceDir

  function evictOldestSessionMeta(): void {
    const oldestKey = sessionMeta.keys().next().value as string | undefined
    if (oldestKey !== undefined) sessionMeta.delete(oldestKey)
  }

  function resolveCwd(): string {
    return workspaceDir ?? process.cwd()
  }

  return {
    // ──────────────────────────────────────────────────────────────────
    // Session
    // ──────────────────────────────────────────────────────────────────
    session: {
      /**
       * Create a new agent session via the SDK.
       *
       * Extracts `.data.id` from the SDK response (same as the original
       * inline adapter). Records agent/model metadata for later use by
       * `prompt()`.
       */
      async create(opts: AgentSessionCreateOptions): Promise<{ id: string }> {
        const result = await client.session.create({} as never) as SdkResponse<{ id?: string }>
        const data = unwrapSdkResponse(result)
        const id = data?.id
        if (!id) throw new Error("Failed to create session: no id in response")
        if (sessionMeta.size >= MAX_SESSION_META) evictOldestSessionMeta()
        sessionMeta.set(id, { agent: opts.agent, model: opts.model })
        return { id }
      },

      /**
       * Send a prompt to an existing session.
       *
       * Uses the SDK's `session.prompt()` with `{ path: { id }, body: { ... } }`
       * format — same as the original inline adapter. Agent/model are resolved
       * from the call-time opts, falling back to the metadata stored at
       * `create()` time.
       */
      async prompt(
        id: string,
        message: string,
        opts?: { agent?: string; model?: string },
      ): Promise<unknown> {
        const meta = sessionMeta.get(id)
        const agent = opts?.agent ?? meta?.agent
        const model = opts?.model ?? meta?.model
        // Build body — only include agent/model when set (undefined would be
        // omitted by JSON.stringify, but explicit is cleaner and safer)
        const body: {
          parts: Array<{ type: string; text: string }>
          agent?: string
          model?: { providerID: string; modelID: string }
        } = {
          parts: [{ type: "text", text: message }],
        }
        if (agent) body.agent = agent
        if (model) body.model = { providerID: "", modelID: model }
        const result = await client.session.prompt({
          path: { id },
          body,
        } as never) as SdkResponse<unknown>
        return unwrapSdkResponse(result)
      },

      /**
       * Read messages from a session.
       *
       * Normalizes the SDK response to `Array<{ role?: string; content?: string }>`
       * — extracting `info.role` and joining text parts into a single string.
       */
      async messages(id: string, limit?: number): Promise<unknown[]> {
        const params: Record<string, unknown> = { path: { id } }
        if (limit !== undefined) {
          params.query = { limit }
        }
        const result = await client.session.messages(params as never) as SdkResponse<
          Array<{
            info: { role?: string }
            parts: Array<{ type: string; text?: string }>
          }>
        >
        const data = unwrapSdkResponse(result)
        if (!data) return []
        return data.map((m) => ({
          role: m.info?.role,
          content:
            m.parts
              ?.filter((p) => p.type === "text")
              .map((p) => p.text ?? "")
              .join("\n") ?? "",
        }))
      },
    },

    // ──────────────────────────────────────────────────────────────────
    // Workspace
    // ──────────────────────────────────────────────────────────────────
    workspace: {
      /**
       * Return the current workspace directory.
       *
       * Uses the override from `options.workspaceDir` if provided,
       * otherwise falls back to `process.cwd()`.
       */
      async current(): Promise<string> {
        return resolveCwd()
      },
    },

    // ──────────────────────────────────────────────────────────────────
    // Git
    // ──────────────────────────────────────────────────────────────────
    git: {
      /**
       * Capture a git snapshot: branch, HEAD commit, and changed files.
       *
       * Runs three git commands via `execFile` with a 2-second timeout.
       * On any failure (not a git repo, git not installed, timeout),
       * returns a snapshot with empty strings and an empty file list —
       * never throws.
       */
      async snapshot(): Promise<GitSnapshot> {
        const cwd = resolveCwd()
        const [branch, head, diffStat] = await Promise.all([
          gitExec(["rev-parse", "--abbrev-ref", "HEAD"], cwd),
          gitExec(["rev-parse", "HEAD"], cwd),
          gitExec(["diff", "--stat"], cwd),
        ])
        return {
          branch,
          head,
          changedFiles: parseDiffStat(diffStat),
        }
      },
    },

    // ──────────────────────────────────────────────────────────────────
    // Capabilities
    // ──────────────────────────────────────────────────────────────────
    /**
     * Capability flags — all default to true (assume available).
     *
     * These can be refined later based on actual runtime behavior or
     * OpenCode version detection. They let the plugin adapt to different
     * runtime environments without code changes.
     */
    capabilities: {
      sessionCreate: true,
      messageRead: true,
      eventStream: true,
      backgroundTask: true,
      toolHook: true,
    },

    // ──────────────────────────────────────────────────────────────────
    // Self-check
    // ──────────────────────────────────────────────────────────────────
    /**
     * Run an adapter self-check.
     *
     * Tests `session.create()` and `session.messages()` — does NOT test
     * `session.prompt()` (it has side effects). Results are returned, not
     * logged.
     *
     * - `session.create({})` → if succeeds, `sessionCreate = true`
     * - `session.messages(id)` → if returns (even empty), `sessionMessages = true`
     * - `sessionPrompt` is always `"untested"` (never tested here)
     * - Errors are collected in the `errors` array
     */
    async healthCheck(): Promise<AdapterHealthResult> {
      const errors: string[] = []
      let sessionCreate = false
      let sessionMessages = false
      let testSessionId: string | undefined

      // 1. Try session.create({}) — creates a throwaway session
      try {
        const result = await client.session.create({} as never) as SdkResponse<{ id?: string }>
        const data = unwrapSdkResponse(result)
        testSessionId = data?.id
        sessionCreate = !!testSessionId
      } catch (err: unknown) {
        errors.push(`session.create: ${err instanceof Error ? err.message : String(err)}`)
      }

      // 2. Try session.messages(id) — does NOT test prompt (side effects)
      try {
        const id = testSessionId ?? "test"
        const params: Record<string, unknown> = { path: { id } }
        const result = await client.session.messages(params as never) as SdkResponse<unknown>
        unwrapSdkResponse(result)
        sessionMessages = true
      } catch (err: unknown) {
        errors.push(`session.messages: ${err instanceof Error ? err.message : String(err)}`)
      }

      return {
        sessionCreate,
        sessionMessages,
        sessionPrompt: "untested",
        errors,
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Git command timeout in milliseconds (2 seconds). */
const GIT_TIMEOUT_MS = 2000

/**
 * Execute a git command and return trimmed stdout.
 *
 * Returns an empty string on any failure (not a git repo, git not
 * installed, timeout, non-zero exit). Never throws.
 */
async function gitExec(args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      encoding: "utf-8",
      timeout: GIT_TIMEOUT_MS,
    })
    return stdout.trim()
  } catch {
    return ""
  }
}

/**
 * Parse `git diff --stat` output into a list of changed files.
 *
 * Output format:
 *   src/adapter.ts        | 45 ++++++++++++++++++
 *   src/config.ts         | 12 ++++--
 *   2 files changed, 57 insertions(+), 2 deletions(-)
 *
 * The summary line (containing "file changed" / "files changed") is
 * skipped. For each file line, `changes` captures everything after the
 * ` | ` separator (e.g., "45 ++++--", "Bin" for binary files).
 */
function parseDiffStat(output: string): Array<{ path: string; changes: string }> {
  const files: Array<{ path: string; changes: string }> = []

  for (const line of output.split("\n")) {
    if (line.trim() === "") continue
    // Skip summary line: "1 file changed, ..." / "2 files changed, ..."
    if (line.includes(" file changed") || line.includes(" files changed")) continue

    // File line format: " <path> | <rest>"
    const pipeIdx = line.indexOf(" | ")
    if (pipeIdx === -1) continue

    const path = line.substring(0, pipeIdx).trim()
    const changes = line.substring(pipeIdx + 3).trim()
    if (path) {
      files.push({ path, changes })
    }
  }

  return files
}
