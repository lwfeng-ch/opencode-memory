/**
 * opencode-memory — Migration Scanner Tests (v0.3.3)
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest"
import { LegacyScanner, SessionScanner, MemoryMigrationScanner } from "../../src/migration/scanner.js"
import { join, dirname } from "node:path"
import { tmpdir } from "node:os"
import { randomBytes } from "node:crypto"
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs"

const SAMPLE_MEMORY = `---
name: Test Memory
description: A test memory
type: user
confidence: explicit
scope: user
createdAt: 1000000
---

This is the memory body content.
`

const SESSION_MEMORY = `---
name: Session Notes
description: Development session notes
type: project
confidence: inferred
---

## Summary
Some notes here.

## Details
More details.
`

describe("LegacyScanner", () => {
  const testDir = join(tmpdir(), `legacy-scan-${randomBytes(4).toString("hex")}`)
  let scanner: LegacyScanner

  beforeEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }) } catch {}
    mkdirSync(testDir, { recursive: true })
    mkdirSync(join(testDir, "legacy", "v1"), { recursive: true })
    scanner = new LegacyScanner(testDir)
  })

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }) } catch {}
  })

  test("finds files in legacy/v1/ directory", async () => {
    writeFileSync(join(testDir, "legacy", "v1", "old.md"), SAMPLE_MEMORY, "utf-8")
    const candidates = await scanner.scanLegacy()
    expect(candidates).toHaveLength(1)
    expect(candidates[0].type).toBe("legacy_v1")
  })

  test("detects duplicate when file exists in current path", async () => {
    writeFileSync(join(testDir, "old.md"), SAMPLE_MEMORY, "utf-8")
    writeFileSync(join(testDir, "legacy", "v1", "old.md"), SAMPLE_MEMORY, "utf-8")
    const candidates = await scanner.scanLegacy()
    expect(candidates[0].reason).toContain("duplicate")
  })

  test("detects no-duplicate when file only in legacy", async () => {
    writeFileSync(join(testDir, "legacy", "v1", "unique.md"), SAMPLE_MEMORY, "utf-8")
    const candidates = await scanner.scanLegacy()
    expect(candidates[0].reason).toContain("no current equivalent")
  })

  test("all candidates have action=delete, risk=low", async () => {
    writeFileSync(join(testDir, "legacy", "v1", "a.md"), SAMPLE_MEMORY, "utf-8")
    writeFileSync(join(testDir, "legacy", "v1", "b.md"), SAMPLE_MEMORY, "utf-8")
    const candidates = await scanner.scanLegacy()
    expect(candidates.every(c => c.action === "delete")).toBe(true)
    expect(candidates.every(c => c.risk === "low")).toBe(true)
  })

  test("extracts preview (title, description, sections)", async () => {
    writeFileSync(join(testDir, "legacy", "v1", "preview.md"), SESSION_MEMORY, "utf-8")
    const candidates = await scanner.scanLegacy()
    expect(candidates[0].preview.title).toBe("Session Notes")
    expect(candidates[0].preview.description).toBe("Development session notes")
    expect(candidates[0].preview.sections).toContain("Summary")
    expect(candidates[0].preview.sections).toContain("Details")
  })

  test("returns empty when legacy/v1/ doesn't exist", async () => {
    rmSync(join(testDir, "legacy"), { recursive: true, force: true })
    const candidates = await scanner.scanLegacy()
    expect(candidates).toEqual([])
  })
})

describe("SessionScanner", () => {
  const testDir = join(tmpdir(), `session-scan-${randomBytes(4).toString("hex")}`)
  let scanner: SessionScanner

  beforeEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }) } catch {}
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }) } catch {}
  })

  test("finds session_*.md files older than threshold", async () => {
    // Create a file with old mtime (60 days ago)
    const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
    const filepath = join(testDir, "session_2026-05-01-notes.md")
    writeFileSync(filepath, SESSION_MEMORY, "utf-8")
    // Manually set mtime to past
    const { utimesSync } = require("node:fs")
    utimesSync(filepath, oldDate, oldDate)

    const scanner = new SessionScanner(testDir, 30)
    const candidates = await scanner.scanSessions()
    expect(candidates).toHaveLength(1)
    expect(candidates[0].type).toBe("stale_session")
    expect(candidates[0].action).toBe("archive")
  })

  test("skips session files newer than threshold", async () => {
    const filepath = join(testDir, "session_recent.md")
    writeFileSync(filepath, SESSION_MEMORY, "utf-8")

    const scanner = new SessionScanner(testDir, 30)
    const candidates = await scanner.scanSessions()
    expect(candidates).toHaveLength(0)
  })

  test("all candidates have action=archive, risk=low", async () => {
    const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
    const filepath = join(testDir, "session_old.md")
    writeFileSync(filepath, SESSION_MEMORY, "utf-8")
    const { utimesSync } = require("node:fs")
    utimesSync(filepath, oldDate, oldDate)

    const scanner = new SessionScanner(testDir, 30)
    const candidates = await scanner.scanSessions()
    expect(candidates.every(c => c.action === "archive")).toBe(true)
    expect(candidates.every(c => c.risk === "low")).toBe(true)
  })

  test("extracts preview with sections", async () => {
    const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
    const filepath = join(testDir, "session_preview.md")
    writeFileSync(filepath, SESSION_MEMORY, "utf-8")
    const { utimesSync } = require("node:fs")
    utimesSync(filepath, oldDate, oldDate)

    const scanner = new SessionScanner(testDir, 30)
    const candidates = await scanner.scanSessions()
    expect(candidates[0].preview.title).toBe("Session Notes")
    expect(candidates[0].preview.sections).toContain("Summary")
    expect(candidates[0].metadata.size).toBeGreaterThan(0)
  })

  test("respects custom threshold", async () => {
    const oldDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) // 5 days ago
    const filepath = join(testDir, "session_5days.md")
    writeFileSync(filepath, SESSION_MEMORY, "utf-8")
    const { utimesSync } = require("node:fs")
    utimesSync(filepath, oldDate, oldDate)

    // threshold=3 days → should be included (5 > 3)
    const scanner3 = new SessionScanner(testDir, 3)
    expect((await scanner3.scanSessions())).toHaveLength(1)

    // threshold=10 days → should be excluded (5 < 10)
    const scanner10 = new SessionScanner(testDir, 10)
    expect((await scanner10.scanSessions())).toHaveLength(0)
  })

  test("ignores non-session files", async () => {
    const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
    writeFileSync(join(testDir, "normal-memory.md"), SESSION_MEMORY, "utf-8")
    const { utimesSync } = require("node:fs")
    utimesSync(join(testDir, "normal-memory.md"), oldDate, oldDate)

    const scanner = new SessionScanner(testDir, 30)
    const candidates = await scanner.scanSessions()
    expect(candidates).toHaveLength(0)
  })
})

describe("MemoryMigrationScanner (combined)", () => {
  const testDir = join(tmpdir(), `combined-scan-${randomBytes(4).toString("hex")}`)
  let scanner: MemoryMigrationScanner

  beforeEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }) } catch {}
    mkdirSync(testDir, { recursive: true })
    mkdirSync(join(testDir, "legacy", "v1"), { recursive: true })

    // Create legacy file
    writeFileSync(join(testDir, "legacy", "v1", "old.md"), SAMPLE_MEMORY, "utf-8")

    // Create old session file
    const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
    const sessionPath = join(testDir, "session_old.md")
    writeFileSync(sessionPath, SESSION_MEMORY, "utf-8")
    const { utimesSync } = require("node:fs")
    utimesSync(sessionPath, oldDate, oldDate)

    // Create normal memory (should not be scanned)
    writeFileSync(join(testDir, "normal.md"), SAMPLE_MEMORY, "utf-8")

    scanner = new MemoryMigrationScanner(
      new LegacyScanner(testDir),
      new SessionScanner(testDir, 30),
    )
  })

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }) } catch {}
  })

  test("scanAll combines legacy + session candidates", async () => {
    const candidates = await scanner.scanAll()
    expect(candidates.length).toBe(2) // 1 legacy + 1 session
    const types = candidates.map(c => c.type)
    expect(types).toContain("legacy_v1")
    expect(types).toContain("stale_session")
  })

  test("scanAll sorts by createdAt", async () => {
    const candidates = await scanner.scanAll()
    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i].createdAt).toBeGreaterThanOrEqual(candidates[i - 1].createdAt)
    }
  })

  test("scanLegacy returns only legacy candidates", async () => {
    const candidates = await scanner.scanLegacy()
    expect(candidates.length).toBe(1)
    expect(candidates[0].type).toBe("legacy_v1")
  })

  test("scanSessions returns only session candidates", async () => {
    const candidates = await scanner.scanSessions()
    expect(candidates.length).toBe(1)
    expect(candidates[0].type).toBe("stale_session")
  })
})
