/**
 * Tests for v0.4.0 Phase B — Store Round Trip
 *
 * Verifies provenance is correctly written to and read from storage:
 * - Write with provenance → read back match
 * - Write without provenance → read back undefined
 * - Update provenance → read back updated
 * - Extraction block round-trip
 * - History array round-trip
 * - Model field round-trip
 * - Extractor version round-trip
 * - Concurrent writes
 * - Large history
 * - Extraction pipeline provenance
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdir, rm, writeFile, readFile } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"
import { randomUUID } from "crypto"
import { FileSystemStore, parseFrontmatter } from "../../src/store.js"
import {
  serializeProvenance,
  parseProvenance,
  type MemoryProvenance,
} from "../../src/memory/provenance.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string

beforeEach(async () => {
  tmpDir = join(tmpdir(), `provenance-test-${randomUUID()}`)
  await mkdir(tmpDir, { recursive: true })
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

function makeFullProvenance(): MemoryProvenance {
  return {
    source: { type: "user", sessionId: "ses_abc" },
    created: { timestamp: 1000, actor: "user" },
    extraction: { method: "explicit", confidenceScore: 1.0 },
    history: [{ action: "created", timestamp: 1000, actor: "user" }],
  }
}

function buildMemoryFile(
  name: string,
  description: string,
  type: string,
  body: string,
  provenance?: string,
): string {
  const lines = ["---", `name: ${name}`, `description: ${description}`, `type: ${type}`]
  if (provenance) lines.push(`provenance: ${provenance}`)
  lines.push("schema_version: 1", "---", "", body)
  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("store round-trip: provenance", () => {
  it("should write memory with provenance and read it back", async () => {
    const store = new FileSystemStore(tmpDir)
    const prov = makeFullProvenance()
    const provenanceJson = serializeProvenance(prov)!
    const content = buildMemoryFile("test", "desc", "user", "hello", provenanceJson)

    await store.write("test.md", content)
    const raw = await store.read("test.md")
    const fm = parseFrontmatter(raw)
    const parsed = parseProvenance(fm.provenance)

    expect(parsed).toBeDefined()
    expect(parsed!.source.type).toBe("user")
    expect(parsed!.source.sessionId).toBe("ses_abc")
    expect(parsed!.created.timestamp).toBe(1000)
    expect(parsed!.extraction?.confidenceScore).toBe(1.0)
    expect(parsed!.history).toHaveLength(1)
  })

  it("should return undefined provenance when frontmatter has no provenance key", async () => {
    const store = new FileSystemStore(tmpDir)
    const content = buildMemoryFile("test", "desc", "user", "no provenance here")

    await store.write("test.md", content)
    const raw = await store.read("test.md")
    const fm = parseFrontmatter(raw)
    const parsed = parseProvenance(fm.provenance)

    expect(parsed).toBeUndefined()
  })

  it("should preserve provenance after update", async () => {
    const store = new FileSystemStore(tmpDir)
    const prov = makeFullProvenance()
    const provenanceJson = serializeProvenance(prov)!

    // Write initial
    const content1 = buildMemoryFile("test", "desc", "user", "v1", provenanceJson)
    await store.write("test.md", content1)

    // Update with new content but same provenance
    const content2 = buildMemoryFile("test", "desc", "user", "v2", provenanceJson)
    await store.write("test.md", content2)

    // Read back
    const raw = await store.read("test.md")
    const fm = parseFrontmatter(raw)
    const parsed = parseProvenance(fm.provenance)

    expect(parsed).toBeDefined()
    expect(parsed!.source.type).toBe("user")
    // Verify body is the updated version
    expect(raw).toContain("v2")
  })

  it("should round-trip with extraction block", async () => {
    const store = new FileSystemStore(tmpDir)
    const prov = makeFullProvenance()
    prov.extraction = { method: "llm", confidenceScore: 0.73 }
    const provenanceJson = serializeProvenance(prov)!
    const content = buildMemoryFile("test", "desc", "user", "llm extraction", provenanceJson)

    await store.write("test.md", content)
    const raw = await store.read("test.md")
    const fm = parseFrontmatter(raw)
    const parsed = parseProvenance(fm.provenance)

    expect(parsed).toBeDefined()
    expect(parsed!.extraction?.method).toBe("llm")
    expect(parsed!.extraction?.confidenceScore).toBe(0.73)
  })

  it("should round-trip with history array (multiple events)", async () => {
    const store = new FileSystemStore(tmpDir)
    const prov = makeFullProvenance()
    prov.history = [
      { action: "created", timestamp: 1000, actor: "user" },
      { action: "updated", timestamp: 2000, actor: "system" },
      { action: "archived", timestamp: 3000, actor: "repair" },
    ]
    const provenanceJson = serializeProvenance(prov)!
    const content = buildMemoryFile("test", "desc", "user", "history test", provenanceJson)

    await store.write("test.md", content)
    const raw = await store.read("test.md")
    const fm = parseFrontmatter(raw)
    const parsed = parseProvenance(fm.provenance)

    expect(parsed).toBeDefined()
    expect(parsed!.history).toHaveLength(3)
    expect(parsed!.history[0].action).toBe("created")
    expect(parsed!.history[1].action).toBe("updated")
    expect(parsed!.history[2].action).toBe("archived")
  })

  it("should round-trip with model field", async () => {
    const store = new FileSystemStore(tmpDir)
    const prov = makeFullProvenance()
    prov.created.model = "gpt-4"
    const provenanceJson = serializeProvenance(prov)!
    const content = buildMemoryFile("test", "desc", "user", "model test", provenanceJson)

    await store.write("test.md", content)
    const raw = await store.read("test.md")
    const fm = parseFrontmatter(raw)
    const parsed = parseProvenance(fm.provenance)

    expect(parsed).toBeDefined()
    expect(parsed!.created.model).toBe("gpt-4")
  })

  it("should round-trip with extractorVersion", async () => {
    const store = new FileSystemStore(tmpDir)
    const prov = makeFullProvenance()
    prov.created.extractorVersion = "0.4.0"
    const provenanceJson = serializeProvenance(prov)!
    const content = buildMemoryFile("test", "desc", "user", "version test", provenanceJson)

    await store.write("test.md", content)
    const raw = await store.read("test.md")
    const fm = parseFrontmatter(raw)
    const parsed = parseProvenance(fm.provenance)

    expect(parsed).toBeDefined()
    expect(parsed!.created.extractorVersion).toBe("0.4.0")
  })

  it("should handle 10 concurrent writes with provenance", async () => {
    const store = new FileSystemStore(tmpDir)
    const promises = Array.from({ length: 10 }, (_, i) => {
      const prov = makeFullProvenance()
      prov.source.sessionId = `ses_${i}`
      const provenanceJson = serializeProvenance(prov)!
      const content = buildMemoryFile(`test-${i}.md`, `desc-${i}`, "user", `body-${i}`, provenanceJson)
      return store.write(`test-${i}.md`, content)
    })

    await Promise.all(promises)

    // Verify all files
    for (let i = 0; i < 10; i++) {
      const raw = await store.read(`test-${i}.md`)
      const fm = parseFrontmatter(raw)
      const parsed = parseProvenance(fm.provenance)
      expect(parsed).toBeDefined()
      expect(parsed!.source.sessionId).toBe(`ses_${i}`)
    }
  })

  it("should handle large history array (50 events)", async () => {
    const store = new FileSystemStore(tmpDir)
    const prov = makeFullProvenance()
    prov.history = Array.from({ length: 50 }, (_, i) => ({
      action: (i % 2 === 0 ? "updated" : "created") as "created" | "updated",
      timestamp: 1000 + i * 100,
      actor: "system" as const,
    }))
    const provenanceJson = serializeProvenance(prov)!
    const content = buildMemoryFile("test", "desc", "user", "large history", provenanceJson)

    await store.write("test.md", content)
    const raw = await store.read("test.md")
    const fm = parseFrontmatter(raw)
    const parsed = parseProvenance(fm.provenance)

    expect(parsed).toBeDefined()
    expect(parsed!.history).toHaveLength(50)
    expect(parsed!.history[49].action).toBe("created")
  })
})