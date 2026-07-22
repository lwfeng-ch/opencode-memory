/**
 * opencode-memory — MemoryPathPolicy (v0.4.1)
 *
 * Unified path ignore policy for Quality, Audit, Scanner, and Migration.
 * Prevents each consumer from maintaining its own exclude logic.
 *
 * Dependency direction: leaf module (zero imports from src/).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IgnoreReason = "backup" | "temporary" | "system" | "session" | "unknown"

export interface MemoryPathPolicyOptions {
  /** If true, session_*.md files are ignored (default: false) */
  ignoreSessions?: boolean
  /** Additional path patterns to ignore (e.g. "legacy/", "temp/") */
  additionalPatterns?: string[]
}

// ---------------------------------------------------------------------------
// MemoryPathPolicy
// ---------------------------------------------------------------------------

export class MemoryPathPolicy {
  private readonly ignoreSessions: boolean
  private readonly additionalPatterns: string[]

  constructor(options: MemoryPathPolicyOptions = {}) {
    this.ignoreSessions = options.ignoreSessions ?? false
    this.additionalPatterns = options.additionalPatterns ?? []
  }

  /**
   * Check if a relative path should be ignored.
   * Returns true if the path matches any ignore pattern.
   */
  isIgnoredPath(relativePath: string): boolean {
    return this.reason(relativePath) !== undefined
  }

  /**
   * Get the reason why a path is ignored.
   * Returns undefined if the path is not ignored.
   */
  reason(relativePath: string): IgnoreReason | undefined {
    const normalized = relativePath.replace(/\\/g, "/")

    // Built-in patterns
    if (this.matchesPattern(normalized, ".memory-backup/")) return "backup"
    if (this.matchesPattern(normalized, ".git/")) return "system"
    if (this.matchesPattern(normalized, "node_modules/")) return "system"
    if (normalized === "MEMORY.md") return "system"
    if (normalized === "ARCHIVE.md") return "system"

    // Session files (optional) — match basename, not full path
    const basename = normalized.split("/").pop() ?? ""
    if (this.ignoreSessions && /^session_\d{4}/.test(basename) && basename.endsWith(".md")) {
      return "session"
    }

    // Custom patterns
    for (const pattern of this.additionalPatterns) {
      if (this.matchesPattern(normalized, pattern)) return "unknown"
    }

    return undefined
  }

  /**
   * Check if a relative path contains a given sub-path pattern.
   * Handles both prefix patterns (e.g. ".memory-backup/") and
   * mid-path patterns (e.g. "legacy/").
   */
  private matchesPattern(path: string, pattern: string): boolean {
    return path === pattern || path.startsWith(pattern) || path.includes(`/${pattern}`)
  }
}

// ---------------------------------------------------------------------------
// Convenience
// ---------------------------------------------------------------------------

/** Default policy: excludes backup, git, node_modules, system index files. */
export function defaultPathPolicy(): MemoryPathPolicy {
  return new MemoryPathPolicy()
}

/** Policy that also excludes session files. */
export function auditPathPolicy(): MemoryPathPolicy {
  return new MemoryPathPolicy({ ignoreSessions: true })
}