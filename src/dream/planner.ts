/**
 * opencode-memory — DreamRunner (v0.5.0)
 *
 * Orchestrates the full Discovery Engine pipeline:
 * Cluster → Evidence → Candidate → Proposal → RepairQueue
 *
 * Each phase is independently testable. The runner only coordinates.
 */

import type { ConflictGraph } from "../conflict/types.js"
import type { EvidenceReport, MemoryFile, FactSummary } from "./analyzer/evidence.js"
import type { ConsolidationCandidate } from "./candidate/types.js"
import { ClusterBuilder } from "./cluster/builder.js"
import { EvidenceCollector } from "./analyzer/evidence.js"
import { CandidateGenerator } from "./candidate/generator.js"
import type { DreamMode } from "./mode.js"
import { getFactRootDir } from "../paths.js"
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

export interface DiscoveryReport {
  totalClusters: number
  totalCandidates: number
  candidates: ConsolidationCandidate[]
  duration: number
  errors: string[]
}

/**
 * Scan fact/sessions/ directory and collect FactSummary records.
 * Indexed by factId ($id) for O(1) lookup during evidence collection.
 *
 * TODO(v0.5.3): Change to on-demand loading — only read fact records
 * referenced by cluster.members[].provenance.factId instead of full scan.
 * Current O(n) scan is acceptable while fact record count is small.
 */
export async function collectFacts(memoryDir: string): Promise<Map<string, FactSummary[]>> {
  const factMap = new Map<string, FactSummary[]>()
  const factRoot = getFactRootDir(memoryDir)
  const sessionsDir = join(factRoot, "sessions")

  try {
    const yearDirs = await readdir(sessionsDir, { withFileTypes: true })
    for (const yearDir of yearDirs) {
      if (!yearDir.isDirectory()) continue
      const monthDir = join(sessionsDir, yearDir.name)
      const monthEntries = await readdir(monthDir, { withFileTypes: true })
      for (const entry of monthEntries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue
        try {
          const content = await readFile(join(monthDir, entry.name), "utf-8")
          const record = JSON.parse(content) as {
            $id: string
            session_id: string
            created_at: string
            stats: { messages: number; tool_calls: number; duration_minutes: number }
            git: { branch: string }
          }
          if (record.$id && record.session_id) {
            const summary: FactSummary = {
              sessionId: record.session_id,
              factId: record.$id,
              timestamp: record.created_at,
              messageCount: record.stats?.messages ?? 0,
              toolCallCount: record.stats?.tool_calls ?? 0,
              durationMinutes: record.stats?.duration_minutes ?? 0,
              gitBranch: record.git?.branch ?? "",
            }
            const existing = factMap.get(record.$id) ?? []
            existing.push(summary)
            factMap.set(record.$id, existing)
          }
        } catch {
          // skip unparseable fact files
        }
      }
    }
  } catch {
    // fact/sessions/ doesn't exist yet — empty map
  }

  return factMap
}

export class DreamRunner {
  private clusterBuilder: ClusterBuilder
  private evidenceCollector: EvidenceCollector
  private candidateGenerator: CandidateGenerator

  constructor() {
    this.clusterBuilder = new ClusterBuilder()
    this.evidenceCollector = new EvidenceCollector()
    this.candidateGenerator = new CandidateGenerator()
  }

  /**
   * Execute the full Discovery pipeline.
   * @param factSummaries — v0.5.1: optional fact data for evidence enrichment.
   *   Can be populated via collectFacts().
   */
  async run(
    conflictGraph: ConflictGraph,
    memories: MemoryFile[],
    _mode: DreamMode = "v0.5",
    factSummaries?: Map<string, FactSummary[]>,
  ): Promise<DiscoveryReport> {
    const t0 = Date.now()
    const errors: string[] = []

    try {
      // Phase 1: Cluster Discovery
      const clusters = this.clusterBuilder.buildAll(
        conflictGraph,
        memories.map((m) => ({ filename: m.filename, content: m.content })),
        memories.map((m) => ({ filename: m.filename, content: m.content })),
      )

      // Phase 2: Evidence Collection
      const evidenceReports: EvidenceReport[] = []
      for (const cluster of clusters) {
        try {
          const evidence = this.evidenceCollector.collect(cluster, memories, factSummaries)
          evidenceReports.push(evidence)
        } catch (err) {
          errors.push(`evidence collection failed for ${cluster.id}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      // Phase 3: Candidate Generation
      const candidates = this.candidateGenerator.generate(clusters, evidenceReports)

      return {
        totalClusters: clusters.length,
        totalCandidates: candidates.length,
        candidates,
        duration: Date.now() - t0,
        errors,
      }
    } catch (err) {
      errors.push(`pipeline failed: ${err instanceof Error ? err.message : String(err)}`)
      return {
        totalClusters: 0,
        totalCandidates: 0,
        candidates: [],
        duration: Date.now() - t0,
        errors,
      }
    }
  }
}