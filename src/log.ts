/**
 * opencode-memory — Logger
 *
 * Routes [memory:*] log output to a file instead of stdout, preventing
 * terminal pollution and garbled text on Windows (CJK + path mixing).
 *
 * Console output is off by default. Set `logging.console: true` in
 * memory.config.json to re-enable for debugging.
 *
 * Log file: {memoryDir}/logs/memory.log (appended, never truncated).
 */

import { appendFile, mkdir } from "fs/promises"
import { dirname } from "path"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LogLevel = "debug" | "info" | "warn" | "error"

export interface LoggingConfig {
  /** Write logs to console (stdout/stderr). Default: false. */
  console: boolean
  /** Write logs to file. Default: true. */
  file: boolean
  /** Minimum level to log. Default: "debug" (everything). */
  level: LogLevel
}

export const DEFAULT_LOGGING_CONFIG: LoggingConfig = {
  console: false,
  file: true,
  level: "debug",
}

// ---------------------------------------------------------------------------
// State (module singleton)
// ---------------------------------------------------------------------------

let logFilePath: string | null = null
let cfg: LoggingConfig = { ...DEFAULT_LOGGING_CONFIG }

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

/**
 * Initialize the logger.
 *
 * Must be called once at plugin startup, before any log() calls.
 * Safe to call multiple times — last call wins.
 *
 * `level` accepts string ("debug"|"info"|"warn"|"error") to avoid
 * importing the LogLevel type in config.ts (prevents circular deps).
 */
export function initLogger(
  logFile: string,
  config?: { console?: boolean; file?: boolean; level?: string },
): void {
  logFilePath = logFile
  cfg = { ...DEFAULT_LOGGING_CONFIG }
  if (config?.console !== undefined) cfg.console = config.console
  if (config?.file !== undefined) cfg.file = config.file
  if (config?.level) {
    const lvl = config.level as LogLevel
    if (lvl in LEVEL_PRIORITY) cfg.level = lvl
  }
}

// ---------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------

/**
 * Write a log line.
 *
 * Format: `[ISO-8601] [level] [tag] message`
 *
 * - File: appended to logFilePath (fire-and-forget, never throws)
 * - Console: written only if cfg.console is true
 *
 * Non-blocking: file I/O is fire-and-forget. If the file can't be written,
 * the error is silently swallowed (logging is best-effort).
 */
export function log(level: LogLevel, tag: string, message: string): void {
  // Level filter
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[cfg.level]) return

  const ts = new Date().toISOString()
  const line = `[${ts}] [${level}] [${tag}] ${message}`

  // Console output (off by default)
  if (cfg.console) {
    if (level === "error") {
      console.error(line)
    } else if (level === "warn") {
      console.warn(line)
    } else {
      console.log(line)
    }
  }

  // File output (on by default, fire-and-forget)
  if (cfg.file && logFilePath) {
    const fp = logFilePath
    // Fire and forget — never await, never throw
    mkdir(dirname(fp), { recursive: true })
      .then(() => appendFile(fp, line + "\n", { encoding: "utf-8" }))
      .catch(() => {})
  }
}

/** Convenience wrappers */
export function debug(tag: string, message: string): void {
  log("debug", tag, message)
}
export function info(tag: string, message: string): void {
  log("info", tag, message)
}
export function warn(tag: string, message: string): void {
  log("warn", tag, message)
}
export function error(tag: string, message: string): void {
  log("error", tag, message)
}
