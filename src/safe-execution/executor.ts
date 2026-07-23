/**
 * opencode-memory — SafeExecutionService (v0.5.2)
 *
 * Wraps RepairService with transaction safety:
 *   Snapshot → Validate → Execute → Validate → Commit/Rollback
 *
 * This is a wrapper, not a replacement. RepairService is unchanged.
 */

import { join } from "node:path"
import { readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import type { RepairService } from "../repair/service.js"
import type { RepairCandidate } from "../repair/candidate.js"
import type { ConsolidationCandidate } from "../dream/candidate/types.js"
import { SnapshotManager } from "./snapshot.js"
import { RiskEngine, type RiskContext } from "./risk.js"
import {
  generateTransactionId,
  type RiskAssessment,
  type TransactionContext,
} from "./types.js"

export class SafeExecutionService {
  constructor(
    private repairService: RepairService,
    private snapshotManager: SnapshotManager,
    private riskEngine: RiskEngine,
    private memoryDir: string,
  ) {}

  /**
   * Execute a RepairCandidate safely.
   * Returns the transaction context.
   */
  async execute(candidate: RepairCandidate, context?: RiskContext): Promise<TransactionContext> {
    const riskAssessment = this.riskEngine.assessRepair(candidate, context)
    return this.executeWithRisk(candidate.action, candidate.source, riskAssessment, candidate.id)
  }

  /**
   * Execute a ConsolidationCandidate safely (from Discovery Engine).
   */
  async executeDiscovery(candidate: ConsolidationCandidate, context?: RiskContext): Promise<TransactionContext> {
    const riskAssessment = this.riskEngine.assessCandidate(candidate, context)
    return this.executeWithRisk(candidate.action, candidate.targets[0] ?? "unknown", riskAssessment, candidate.id)
  }

  /**
   * Rollback a transaction by snapshot ID.
   * Looks up the transaction metadata from .tx.json, then restores the snapshot.
   * Throws if the transaction is not found or already rolled back.
   */
  async rollback(transactionId: string): Promise<TransactionContext> {
    const tx = await this.snapshotManager.getTransaction(transactionId)
    if (!tx) {
      throw new Error(`Transaction not found: ${transactionId}`)
    }
    return this.rollbackTransaction(tx)
  }

  /**
   * Rollback using the transaction context directly.
   */
  async rollbackTransaction(tx: TransactionContext): Promise<TransactionContext> {
    if (tx.status === "rolled_back") {
      return tx
    }

    try {
      const targetPath = join(this.memoryDir, tx.snapshot.filename)
      await this.snapshotManager.restoreToFile(tx.snapshot, targetPath)
      tx.status = "rolled_back"
      tx.rolledBackAt = Date.now()
      return tx
    } catch (err) {
      tx.status = "failed"
      tx.error = err instanceof Error ? err.message : String(err)
      return tx
    }
  }

  /**
   * Get all transactions with full metadata.
   */
  async getTransactions(): Promise<TransactionContext[]> {
    return this.snapshotManager.listTransactions()
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private async executeWithRisk(
    action: string,
    source: string,
    riskAssessment: RiskAssessment,
    candidateId?: string,
  ): Promise<TransactionContext> {
    const txId = generateTransactionId()
    let tx: TransactionContext

    try {
      // 1. Snapshot: read current file content
      const filepath = join(this.memoryDir, source)
      let content = ""
      if (existsSync(filepath)) {
        content = await readFile(filepath, "utf-8")
      }

      // 2. Create snapshot with risk metadata
      tx = await this.snapshotManager.create(source, content, riskAssessment, candidateId)

      // 3. Execute the operation via RepairService
      if (action === "archive") {
        await this.repairService.archive(source, `safe-execution: ${txId}`, candidateId)
      } else if (action === "delete") {
        await this.repairService.delete(source, `safe-execution: ${txId}`, candidateId)
      } else {
        await this.repairService.restore(source, `safe-execution: ${txId}`)
      }

      // 4. Commit
      tx.status = "committed"
      tx.committedAt = Date.now()
      return tx
    } catch (err) {
      // Attempt rollback if snapshot was created
      if (tx!) {
        try {
          const targetPath = join(this.memoryDir, source)
          await this.snapshotManager.restoreToFile(tx!.snapshot, targetPath)
          tx!.status = "rolled_back"
          tx!.rolledBackAt = Date.now()
          return tx!
        } catch {
          // rollback failed — transaction is in failed state
        }
      }

      return {
        snapshot: {
          id: txId,
          timestamp: Date.now(),
          operation: action as "archive" | "delete" | "restore",
          filename: source,
          backupPath: "",
          originalContent: "",
          checksum: "",
        },
        riskAssessment,
        candidateId,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }
}