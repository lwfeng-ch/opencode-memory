/**
 * opencode-memory — Migration Scanner (v0.3.3)
 *
 * Scans memory store for legacy/v1 duplicates and stale session files.
 * Produces RepairCandidate[] for the Candidate Queue.
 *
 * v0.3.3 scope: legacy + session only.
 * Deferred to v0.4.0: duplicate scanner (needs embedding + merge strategy).
 */

import { join, relative, basename } from "node:path"
import { readdir, readFile, stat } from "node:fs/promises"
import { existsSync } from "node:fs"
import {
  generateCandidateId,
  type RepairCandidate,
} from "../repair/candidate.js"

// ---------------------------------------------------------------------------
// Frontmatter parsing (minimal — for preview extraction)
// ---------------------------------------------------------------------------

interface ParsedMemory {
  frontmatter: Record<string, string>
  body: string
}

function parseFrontmatter(content: string): ParsedMemory {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) {
    return { frontmatter: {}, body: content }
  }
  const fm: Record<string, string> = {}
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":")
    if (idx > 0) {
      const key = line.slice(0, idx).trim()
      const val = line.slice(idx + 1).trim()
      fm[key] = val
    }
  }
  return { frontmatter: fm, body: match[2] }
}

function extractSectionHeadings(body: string): string[] {
  const headings: string[] = []
  for (const line of body.split("\n")) {
    const m = line.match(/^#{1,3}\s+(.+)$/)
    if (m) headings.push(m[1].trim())
  }
  return headings.slice(0, 5) // max 5 sections in preview
}

// ---------------------------------------------------------------------------
// Scanner Interface
// ---------------------------------------------------------------------------

export interface MigrationScanner {
  scanAll(): Promise<RepairCandidate[]>
  scanLegacy(): Promise<RepairCandidate[]>
  scanSessions(): Promise<RepairCandidate[]>
}

// ---------------------------------------------------------------------------
// Legacy Scanner — finds files in legacy/v1/ subdirectory
// ---------------------------------------------------------------------------

export class LegacyScanner {
  constructor(private memoryDir: string) {}

  async scanLegacy(): Promise<RepairCandidate[]> {
    const legacyDir = join(this.memoryDir, "legacy", "v1")
    if (!existsSync(legacyDir)) return []

    const files = await readdir(legacyDir).catch(() => [] as string[])
    const candidates: RepairCandidate[] = []

    for (const file of files) {
      if (!file.endsWith(".md")) continue
      const legacyPath = join(legacyDir, file)
      const currentPath = join(this.memoryDir, file)
      const isDuplicate = existsSync(currentPath)

      try {
        const content = await readFile(legacyPath, "utf-8")
        const { frontmatter, body } = parseFrontmatter(content)
        const fileStat = await stat(legacyPath)

        candidates.push({
          id: generateCandidateId(),
          type: "legacy_v1",
          action: "delete",
          source: relative(this.memoryDir, legacyPath),
          reason: isDuplicate
            ? "Legacy v1 duplicate — file exists in current path"
            : "Legacy v1 file — no current equivalent, verify before delete",
          metadata: {
            size: fileStat.size,
            createdAt: frontmatter.createdAt ? Number(frontmatter.createdAt) : fileStat.mtimeMs,
            lastModified: fileStat.mtimeMs,
          },
          preview: {
            title: frontmatter.name || file,
            description: frontmatter.description || "",
            sections: extractSectionHeadings(body),
          },
          risk: "low",
          status: "pending",
          createdAt: Date.now(),
        })
      } catch {
        // skip unreadable files
      }
    }

    return candidates
  }
}

// ---------------------------------------------------------------------------
// Session Scanner — finds session_*.md files older than threshold
// ---------------------------------------------------------------------------

export class SessionScanner {
  constructor(
    private memoryDir: string,
    private archiveThresholdDays: number = 30,
  ) {}

  async scanSessions(): Promise<RepairCandidate[]> {
    const files = await readdir(this.memoryDir).catch(() => [] as string[])
    const sessionFiles = files.filter(f => f.startsWith("session_") && f.endsWith(".md"))
    const candidates: RepairCandidate[] = []

    for (const file of sessionFiles) {
      const filepath = join(this.memoryDir, file)
      try {
        const content = await readFile(filepath, "utf-8")
        const { frontmatter, body } = parseFrontmatter(content)
        const fileStat = await stat(filepath)

        const ageDays = (Date.now() - fileStat.mtimeMs) / (1000 * 60 * 60 * 24)
        if (ageDays < this.archiveThresholdDays) continue

        candidates.push({
          id: generateCandidateId(),
          type: "stale_session",
          action: "archive",
          source: file,
          reason: `Session artifact — ${Math.round(ageDays)} days old, conversation notes not memory`,
          metadata: {
            size: fileStat.size,
            createdAt: frontmatter.createdAt ? Number(frontmatter.createdAt) : fileStat.mtimeMs,
            lastModified: fileStat.mtimeMs,
          },
          preview: {
            title: frontmatter.name || basename(file, ".md"),
            description: frontmatter.description || "",
            sections: extractSectionHeadings(body),
          },
          risk: "low",
          status: "pending",
          createdAt: Date.now(),
        })
      } catch {
        // skip unreadable files
      }
    }

    return candidates
  }
}

// ---------------------------------------------------------------------------
// Combined Scanner
// ---------------------------------------------------------------------------

export class MemoryMigrationScanner implements MigrationScanner {
  constructor(
    private legacyScanner: LegacyScanner,
    private sessionScanner: SessionScanner,
  ) {}

  async scanAll(): Promise<RepairCandidate[]> {
    const legacy = await this.legacyScanner.scanLegacy()
    const sessions = await this.sessionScanner.scanSessions()
    return [...legacy, ...sessions].sort((a, b) => a.createdAt - b.createdAt)
  }

  async scanLegacy(): Promise<RepairCandidate[]> {
    return this.legacyScanner.scanLegacy()
  }

  async scanSessions(): Promise<RepairCandidate[]> {
    return this.sessionScanner.scanSessions()
  }
}
