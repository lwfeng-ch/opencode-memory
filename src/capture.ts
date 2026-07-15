/**
 * opencode-memory — Fact Layer: Deterministic Session Capture
 *
 * Captures raw session facts on session.idle. Zero LLM calls, zero
 * semantic judgment — this module only records what happened, not what
 * it means. The fact record is IMMUTABLE after write; processing metadata
 * lives in separate files under processing/.
 *
 * Design principle: LLM failure does not lose data; it only delays
 * knowledge formation. The fact layer is the safety net.
 *
 * See: docs/specs/2026-07-10-memory-infrastructure-design.md § Fact Layer
 */

import { createHash } from "crypto"
import { writeFile, mkdir, readFile } from "fs/promises"
import { dirname, basename, join } from "path"
import { fileURLToPath } from "url"
import type { RuntimeAdapter, GitSnapshot } from "./adapter.js"
import { getFactSessionPath } from "./paths.js"
import { updateState } from "./state.js"
import { info as logInfo, warn as logWarn, error as logError } from "./log.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Tool event recorded during the session — privacy-safe (no arguments). */
interface ToolEvent {
  type: string
  name: string
  success: boolean
  durationMs: number
}

/** Context passed to captureSession — everything needed to produce a fact record. */
export interface CaptureContext {
  sessionId: string
  adapter: RuntimeAdapter
  memoryDir: string
  statePath: string
  messageCount: number
  toolCallCount: number
  toolEvents: ToolEvent[]
  firstMessageAt: string | null
}

/** Immutable fact record written to fact/sessions/YYYY/MM/session_xxx.json. */
interface FactSessionRecord {
  $id: string
  session_id: string
  created_at: string
  ended_at: string
  project: string
  project_dir: string
  runtime: {
    opencode_version: string
    plugin_version: string
    model: string
  }
  git: {
    branch: string
    head: string
    changed_files: Array<{ path: string; changes: string }>
  }
  stats: {
    messages: number
    tool_calls: number
    duration_minutes: number
  }
  events: Array<{
    type: string
    name: string
    success: boolean
    duration_ms: number
  }>
  integrity: {
    hash: string
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Capture a session's raw facts to the fact layer.
 *
 * This function is ALWAYS deterministic — no LLM calls, no prompts, no
 * semantic judgment. It records what happened (git state, message/tool
 * counts, duration) and writes an immutable JSON record.
 *
 * The fact record is never modified after write. Processing metadata
 * (extraction status, dream status) lives in separate files under
 * processing/.
 *
 * Tool events contain only: type, name, success, duration_ms — never
 * arguments (privacy, token bloat, file bloat).
 *
 * All errors are caught and logged — captureSession never throws.
 */
export async function captureSession(ctx: CaptureContext): Promise<void> {
  try {
    // 1. Git snapshot — empty on failure (not a git repo, git not installed)
    let gitSnapshot: GitSnapshot
    try {
      gitSnapshot = await ctx.adapter.git.snapshot()
    } catch {
      gitSnapshot = { branch: "", head: "", changedFiles: [] }
    }

    // 2. Project directory — fallback to process.cwd()
    let projectDir: string
    try {
      projectDir = await ctx.adapter.workspace.current()
    } catch {
      projectDir = process.cwd()
    }

    // 3. Timestamps and duration
    const endedAt = new Date().toISOString()
    const createdAt = ctx.firstMessageAt ?? endedAt
    const durationMinutes = Math.round(
      (new Date(endedAt).getTime() - new Date(createdAt).getTime()) / 60000,
    )

    // 4. Runtime info
    const opencodeVersion = process.env.OPENCODE_VERSION ?? "unknown"
    const pluginVersion = await getPluginVersion()

    // 5. Assemble the fact record (integrity.hash is placeholder for now)
    const record: FactSessionRecord = {
      $id: `memory://fact-session/${ctx.sessionId}`,
      session_id: ctx.sessionId,
      created_at: createdAt,
      ended_at: endedAt,
      project: basename(projectDir),
      project_dir: projectDir,
      runtime: {
        opencode_version: opencodeVersion,
        plugin_version: pluginVersion,
        model: "unknown",
      },
      git: {
        branch: gitSnapshot.branch,
        head: gitSnapshot.head,
        changed_files: gitSnapshot.changedFiles.map((f) => ({
          path: f.path,
          changes: f.changes,
        })),
      },
      stats: {
        messages: ctx.messageCount,
        tool_calls: ctx.toolCallCount,
        duration_minutes: durationMinutes,
      },
      events: ctx.toolEvents.map((e) => ({
        type: e.type,
        name: e.name,
        success: e.success,
        duration_ms: e.durationMs,
      })),
      integrity: {
        hash: "",
      },
    }

    // 6. Compute integrity hash (SHA-256 of JSON payload, excluding the hash value)
    const hashInput = JSON.stringify(record)
    const hash = createHash("sha256").update(hashInput).digest("hex")
    record.integrity.hash = `sha256:${hash}`

    // 7. Write to fact/sessions/YYYY/MM/session_xxx.json
    const factPath = getFactSessionPath(ctx.memoryDir, ctx.sessionId)
    await mkdir(dirname(factPath), { recursive: true })
    await writeFile(factPath, JSON.stringify(record, null, 2), { encoding: "utf-8" })

    // 8. Update state.json — capture stats (non-fatal: fact record already written)
    try {
      await updateState(ctx.statePath, (s) => {
        s.capture.total_sessions_captured++
        s.capture.last_session_id = ctx.sessionId
        s.capture.last_capture_at = endedAt
        // Accumulate messages for dream message-threshold gate
        s.dream.messages_since_last += ctx.messageCount
      })
    } catch (err) {
      // State update failure is non-fatal — the fact record is already on disk.
      // Log as warning, not error, so the capture is still reported as success.
      logWarn("memory:capture", `session=${ctx.sessionId} state update failed: ${err instanceof Error ? err.message : String(err)}`)
    }

    // 9. Log success
    logInfo("memory:capture", `session=${ctx.sessionId} captured`)
  } catch (err) {
    logError("memory:capture", `session=${ctx.sessionId} error=${err instanceof Error ? err.message : String(err)}`)
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read the plugin version from package.json.
 *
 * Falls back to "0.2.0" if package.json is missing, unreadable, or
 * doesn't contain a version field.
 */
async function getPluginVersion(): Promise<string> {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json")
    const raw = await readFile(pkgPath, { encoding: "utf-8" })
    const pkg = JSON.parse(raw) as { version?: string }
    return pkg.version ?? "0.2.0"
  } catch {
    return "0.2.0"
  }
}
