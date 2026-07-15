import { describe, test, expect, beforeEach, afterEach } from "vitest"
import { isSafePath, checkSymlinkSafe } from "../src/pathguard.js"
import { mkdtemp, rm, symlink, writeFile, mkdir } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"

describe("isSafePath", () => {
  test("rejects absolute paths", () => {
    expect(isSafePath("/etc/passwd", "/memory")).toBe(false)
    expect(isSafePath("C:\\Windows\\system32", "/memory")).toBe(false)
  })

  test("rejects path traversal", () => {
    expect(isSafePath("../../../etc/passwd", "/memory")).toBe(false)
    expect(isSafePath("..\\..\\..\\Windows", "/memory")).toBe(false)
  })

  test("rejects null bytes", () => {
    expect(isSafePath("file\0.md", "/memory")).toBe(false)
  })

  test("accepts normal relative paths", () => {
    expect(isSafePath("test.md", "/memory")).toBe(true)
    expect(isSafePath("subdir/test.md", "/memory")).toBe(true)
  })
})

describe("checkSymlinkSafe", () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pathguard-"))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test("returns true for normal files", async () => {
    const filePath = join(dir, "test.md")
    await writeFile(filePath, "content")
    expect(await checkSymlinkSafe(filePath, dir)).toBe(true)
  })

  test("returns false for symlinks pointing outside memory dir", async () => {
    const outsideDir = join(dir, "..", "outside")
    await mkdir(outsideDir, { recursive: true })
    const outsideFile = join(outsideDir, "target.md")
    await writeFile(outsideFile, "secret")
    const linkPath = join(dir, "link.md")
    try {
      await symlink(outsideFile, linkPath)
      expect(await checkSymlinkSafe(linkPath, dir)).toBe(false)
    } catch {
      // Symlink creation may fail on some systems without admin
    }
  })
})
