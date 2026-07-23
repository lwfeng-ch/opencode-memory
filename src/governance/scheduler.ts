/**
 * opencode-memory — GovernanceScheduler (v0.5.3)
 *
 * Orchestrates the autonomous governance cycle:
 *   1. Read pending candidates from RepairQueue
 *   2. Filter auto-executable candidates (via RiskEngine)
 *   3. Execute via SafeExecutionService
 *   4. Update state
 *
 * This is a PURE ORCHESTRATOR — it reuses DreamRunner, RiskEngine,
 * SafeExecutionService, and RepairQueue. No new algorithms.
 *
 * Key design decision: Governance does NOT re-run DreamRunner.
 * Dream already runs as Phase 3 in the session.idle pipeline.
 * Governance reads the existing RepairQueue candidates.
 */

import type { RepairCandidate } from "../repair/candidate.js"
import type { GovernanceConfig, GovernanceReport, ScheduledAction } from "./types.js"
import { RiskEngine } from "../safe-execution/risk.js"
import { SafeExecutionService } from "../safe-execution/executor.js"
import { SnapshotManager } from "../safe-execution/snapshot.js"
import { RepairService } from "../repair/service.js"
import { AuditLog } from "../repair/audit.js"
import { loadState, updateState } from "../state.js"
import { FileCandidateQueue } from "../repair/queue.js"

export class GovernanceScheduler {
  /**
   * Check if governance should run.
   * Returns false when:
   *   - governance is disabled
   *   - less than minHoursBetweenRuns since last run
   */
  async shouldRun(config: GovernanceConfig, statePath: string): Promise<boolean> {
    if (!config.enabled) return false

    try {
      const state = await loadState(statePath)
      const lastRun = state.governance?.last_run_at
      if (lastRun) {
        const elapsed = Date.now() - new Date(lastRun).getTime()
        if (elapsed < config.minHoursBetweenRuns * 3_600_000) return false
      }
      return true
    } catch {
      return false
    }
  }

  /**
   * Run one governance cycle:
   *   1. Read pending RepairQueue candidates
   *   2. Filter autoExecutable
   *   3. Execute (up to maxAutoPerRun)
   *   4. Update state
   */
  async runCycle(
    memoryDir: string,
    auditLogPath: string,
    statePath: string,
    queueDir: string,
    config: GovernanceConfig,
  ): Promise<GovernanceReport> {
    const t0 = Date.now()
    const actions: ScheduledAction[] = []

    // 1. Read pending candidates
    const queue = new FileCandidateQueue(queueDir)
    const pending = await queue.getPending()

    // 2. Filter autoExecutable
    const riskEngine = new RiskEngine()
    const autoCandidates: Array<{ candidate: RepairCandidate; riskScore: number }> = []

    for (const candidate of pending) {
      const risk = riskEngine.assessRepair(candidate)
      if (risk.autoExecutable) {
        autoCandidates.push({ candidate, riskScore: risk.score })
      }
    }

    const toExecute = autoCandidates.slice(0, config.maxAutoPerRun)
    const skipped = autoCandidates.length - toExecute.length

    // 3. Execute if autoExecute is enabled
    if (config.autoExecute && toExecute.length > 0) {
      const repairService = new RepairService(memoryDir, new AuditLog(auditLogPath))
      const snapshotManager = new SnapshotManager(memoryDir)
      const executor = new SafeExecutionService(repairService, snapshotManager, riskEngine, memoryDir)

      for (const { candidate, riskScore } of toExecute) {
        try {
          const tx = await executor.execute(candidate)
          actions.push({
            candidateId: candidate.id,
            action: candidate.action,
            filename: candidate.source,
            result: tx.status,
            riskScore,
          })
          await queue.updateStatus(candidate.id, "executed")
        } catch (err) {
          actions.push({
            candidateId: candidate.id,
            action: candidate.action,
            filename: candidate.source,
            result: "failed",
            riskScore,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
    }

    // 4. Update state
    const successCount = actions.filter((a) => a.result === "committed").length
    const failedCount = actions.filter((a) => a.result === "failed").length

    await updateState(statePath, (s) => {
      s.governance = {
        last_run_at: new Date().toISOString(),
        total_actions: actions.length,
        total_success: successCount,
        total_failed: failedCount,
      }
    })

    return {
      ranAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
      autoExecuted: actions.length,
      skipped,
      actions,
    }
  }
}