/**
 * Tests for v0.4.1 Phase A2 — MemoryPathPolicy
 *
 * Verifies:
 * - Built-in ignore patterns (backup, git, system index)
 * - Session ignore enabled/disabled
 * - node_modules
 * - Custom additional patterns
 * - Normal path NOT ignored
 * - reason() returns correct IgnoreReason
 */

import { describe, it, expect } from "vitest"
import { MemoryPathPolicy, defaultPathPolicy, auditPathPolicy } from "../../src/validation/path-policy.js"

describe("MemoryPathPolicy — built-in patterns", () => {
  const policy = defaultPathPolicy()

  it("should ignore .memory-backup/ paths", () => {
    expect(policy.isIgnoredPath(".memory-backup/provenance-20260722/a.md")).toBe(true)
    expect(policy.reason(".memory-backup/provenance-20260722/a.md")).toBe("backup")
  })

  it("should ignore .git/ paths", () => {
    expect(policy.isIgnoredPath(".git/config")).toBe(true)
    expect(policy.reason(".git/config")).toBe("system")
  })

  it("should ignore node_modules/ paths", () => {
    expect(policy.isIgnoredPath("node_modules/some-package/index.md")).toBe(true)
    expect(policy.reason("node_modules/some-package/index.md")).toBe("system")
  })

  it("should ignore MEMORY.md", () => {
    expect(policy.isIgnoredPath("MEMORY.md")).toBe(true)
    expect(policy.reason("MEMORY.md")).toBe("system")
  })

  it("should ignore ARCHIVE.md", () => {
    expect(policy.isIgnoredPath("ARCHIVE.md")).toBe(true)
    expect(policy.reason("ARCHIVE.md")).toBe("system")
  })
})

describe("MemoryPathPolicy — session files", () => {
  it("should NOT ignore session files by default", () => {
    const policy = defaultPathPolicy()
    expect(policy.isIgnoredPath("session_2026-07-22-test.md")).toBe(false)
    expect(policy.reason("session_2026-07-22-test.md")).toBeUndefined()
  })

  it("should ignore session files when ignoreSessions=true", () => {
    const policy = auditPathPolicy()
    expect(policy.isIgnoredPath("session_2026-07-22-test.md")).toBe(true)
    expect(policy.reason("session_2026-07-22-test.md")).toBe("session")
  })

  it("should ignore session files with nested paths", () => {
    const policy = auditPathPolicy()
    expect(policy.isIgnoredPath("sessions/session_2026-07-22-test.md")).toBe(true)
  })
})

describe("MemoryPathPolicy — custom patterns", () => {
  it("should ignore additional patterns", () => {
    const policy = new MemoryPathPolicy({ additionalPatterns: ["legacy/", "temp/"] })
    expect(policy.isIgnoredPath("legacy/v1/file.md")).toBe(true)
    expect(policy.reason("legacy/v1/file.md")).toBe("unknown")
    expect(policy.isIgnoredPath("temp/scratch.md")).toBe(true)
  })

  it("should not ignore normal paths through custom patterns", () => {
    const policy = new MemoryPathPolicy({ additionalPatterns: ["legacy/"] })
    expect(policy.isIgnoredPath("normal/file.md")).toBe(false)
    expect(policy.isIgnoredPath("src/index.ts")).toBe(false)
  })
})

describe("MemoryPathPolicy — normal paths", () => {
  const policy = defaultPathPolicy()

  it("should NOT ignore normal memory files", () => {
    expect(policy.isIgnoredPath("user_role.md")).toBe(false)
    expect(policy.reason("user_role.md")).toBeUndefined()
  })

  it("should NOT ignore nested memory files", () => {
    expect(policy.isIgnoredPath("semantic/sessions/session_data.md")).toBe(false)
  })

  it("should NOT ignore files with similar names", () => {
    expect(policy.isIgnoredPath("my-backup.md")).toBe(false)
    expect(policy.isIgnoredPath("not-MEMORY.md")).toBe(false)
  })
})

describe("MemoryPathPolicy — Windows path compatibility", () => {
  const policy = defaultPathPolicy()

  it("should handle Windows backslash paths", () => {
    expect(policy.isIgnoredPath(".memory-backup\\provenance-20260722\\a.md")).toBe(true)
  })
})

describe("defaultPathPolicy and auditPathPolicy", () => {
  it("defaultPathPolicy should not ignore sessions", () => {
    const policy = defaultPathPolicy()
    expect(policy.isIgnoredPath("session_2026.md")).toBe(false)
  })

  it("auditPathPolicy should ignore sessions", () => {
    const policy = auditPathPolicy()
    expect(policy.isIgnoredPath("session_2026.md")).toBe(true)
  })
})