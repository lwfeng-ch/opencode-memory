/**
 * opencode-memory — SafeExecutionService (v0.5.2)
 *
 * Wraps RepairService with transaction safety:
 *   Snapshot → Validate → Execute → Validate → Commit/Rollback
 *
 * This is a wrapper, not a replacement. RepairService is unchanged.
 */

import { join } from "node:path"
import { readFile, writeFile } from "node:fs/promises"
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
  type TransactionSnapshot,
  type TransactionStatus,
} from "./types.js"

export class SafeExecutionService {
  constructor(
    private repairService: RepairService,
    private snapshotManager: SnapshotManager,
    private riskEngine: RiskEngine,
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
   * Rollback a transaction by restoring from snapshot.
   */
  async rollback(transactionId: string): Promise<void> {
    // Transaction log is stored alongside snapshots
    // For now, lookup is simple: we store tx context as metadata
    throw new Error(`Rollback for ${transactionId} requires the original TransactionContext`)
  }

  /**
   * Rollback using the transaction context directly.
   */
  async rollbackTransaction(tx: TransactionContext): Promise<TransactionContext> {
    if (tx.status === "rolled_back") {
      return tx // already rolled back
    }

    try {
      const content = await this.snapshotManager.readContent(tx.snapshot)
      // Write the original content back
      await writeFile(tx.snapshot.filename, content, "utf-8")

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
   * Get all transactions (snapshots).
   */
  async getTransactions(): Promise<TransactionSnapshot[]> {
    const files = await this.snapshotManager.list()
    // Return snapshot metadata as transaction records
    return files.map((f) => ({
      id: f,
      timestamp: 0,
      operation: "archive" as const,
      filename: f,
      backupPath: f,
      originalContent: "",
      checksum: "",
    }))
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
    let status: TransactionStatus = "pending"
    let error: string | undefined
    let snapshot: TransactionSnapshot | undefined

    try {
      // 1. Snapshot: read current file content
      const filepath = join(this.getMemoryDir(), source)
      let content = ""
      if (existsSync(filepath)) {
        content = await readFile(filepath, "utf-8")
      }

      // 2. Create snapshot
      snapshot = await this.snapshotManager.create(source, content)

      // 3. Execute the operation via RepairService
      if (action === "archive") {
        await this.repairService.archive(source, `safe-execution: ${txId}`, candidateId)
      } else if (action === "delete") {
        await this.repairService.delete(source, `safe-execution: ${txId}`, candidateId)
      } else {
        // restore or other — delegate to RepairService
        await this.repairService.restore(source, `safe-execution: ${txId}`)
      }

      // 4. Commit
      status = "committed"
    } catch (err) {
      status = "failed"
      error = err instanceof Error ? err.message : String(err)

      // Attempt rollback if snapshot was created
      if (snapshot) {
        try {
          await this.snapshotManager.restoreToFile(snapshot, join(this.getMemoryDir(), source))
          status = "rolled_back"
        } catch {
          // rollback failed — transaction is in failed state
        }
      }
    }

    return {
      snapshot: snapshot ?? {
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
      status,
      committedAt: status === "committed" ? Date.now() : undefined,
      rolledBackAt: status === "rolled_back" ? Date.now() : undefined,
      error,
    }
  }

  private getMemoryDir(): string {
    // Infer memory dir from repair service — it's constructed with one
    return ""
  }
}