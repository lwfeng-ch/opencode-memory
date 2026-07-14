import { describe, test, expect } from "vitest"
import { checkMemoryPressure } from "../src/health.js"
import { FileSystemStore } from "../src/store.js"
import { resolveConfig } from "../src/config.js"
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"

async function withTmpDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "health-"))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe("checkMemoryPressure", () => {
  test("normal level with empty directory", async () => {
    await withTmpDir(async (tmpDir) => {
      const store = new FileSystemStore(tmpDir)
      const config = resolveConfig()
      const result = await checkMemoryPressure(store, config)
      expect(result.level).toBe("normal")
      expect(result.fileCount).toBe(0)
      expect(result.indexSize).toBe(0)
    })
  })

  test("normal level with few files", async () => {
    await withTmpDir(async (tmpDir) => {
      for (let i = 0; i < 10; i++) {
        await writeFile(join(tmpDir, `file${i}.md`), `---\ntype: user\n---\ncontent ${i}`)
      }
      const store = new FileSystemStore(tmpDir)
      const config = resolveConfig()
      const result = await checkMemoryPressure(store, config)
      expect(result.level).toBe("normal")
      expect(result.fileCount).toBe(10)
    })
  })

  test("critical level when file count exceeds 90% of maxFiles", async () => {
    await withTmpDir(async (tmpDir) => {
      // maxFiles default = 500, critical ratio = 0.9 → need > 450 files
      // Use a smaller config to avoid creating 450 files
      const config = resolveConfig()
      config.memoryPressure.maxFiles = 100
      config.memoryPressure.criticalRatio = 0.9
      // Create 91 files (> 0.9 * 100 = 90)
      for (let i = 0; i < 91; i++) {
        await writeFile(join(tmpDir, `file${i}.md`), `---\ntype: user\n---\ncontent ${i}`)
      }
      const store = new FileSystemStore(tmpDir)
      const result = await checkMemoryPressure(store, config)
      expect(result.level).toBe("critical")
      expect(result.fileCount).toBe(91)
    })
  })

  test("elevated level when file count between 70% and 90%", async () => {
    await withTmpDir(async (tmpDir) => {
      const config = resolveConfig()
      config.memoryPressure.maxFiles = 100
      config.memoryPressure.elevatedRatio = 0.7
      config.memoryPressure.criticalRatio = 0.9
      // Create 75 files (0.75 * 100 → elevated)
      for (let i = 0; i < 75; i++) {
        await writeFile(join(tmpDir, `file${i}.md`), `---\ntype: user\n---\ncontent ${i}`)
      }
      const store = new FileSystemStore(tmpDir)
      const result = await checkMemoryPressure(store, config)
      expect(result.level).toBe("elevated")
      expect(result.fileCount).toBe(75)
    })
  })

  test("index size triggers pressure", async () => {
    await withTmpDir(async (tmpDir) => {
      const config = resolveConfig()
      config.memoryPressure.maxFiles = 1000  // high enough that file count won't trigger
      config.memoryPressure.maxIndexSize = 100  // very small → any index triggers
      config.memoryPressure.criticalRatio = 0.9
      await writeFile(join(tmpDir, "file.md"), `---\ntype: user\n---\ncontent`)
      const store = new FileSystemStore(tmpDir)
      // Write a large index
      await store.updateIndex("- [test](file.md) — " + "x".repeat(200))
      const result = await checkMemoryPressure(store, config)
      // index size > 100 * 0.9 = 90 bytes
      expect(result.indexSize).toBeGreaterThan(90)
      expect(result.level).toBe("critical")
    })
  })

  test("lastCheck is a valid ISO timestamp", async () => {
    await withTmpDir(async (tmpDir) => {
      const store = new FileSystemStore(tmpDir)
      const config = resolveConfig()
      const result = await checkMemoryPressure(store, config)
      const parsed = new Date(result.lastCheck)
      expect(parsed.getTime()).not.toBeNaN()
    })
  })
})
