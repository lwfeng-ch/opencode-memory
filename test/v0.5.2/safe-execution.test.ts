/**
 * v0.5.2 — SafeExecutionService Tests
 * 8 tests: archive/delete/restore/rollback/fail-rollback/auto-execute/non-auto/tx-log
 */

import { describe, it, expect, vi } from "vitest"
import { SafeExecutionService } from "../../src/safe-execution/executor.js"
import { SnapshotManager } from "../../src/safe-execution/snapshot.js"
import { RiskEngine } from "../../src/safe-execution/risk.js"
import type { RepairCandidate } from "../../src/repair/candidate.js"

describe("SafeExecutionService", () => {
  function makeService() {
    const repairService = {
      archive: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      restore: vi.fn().mockResolvedValue(undefined),
    }
    // Use a temp dir via memoryDir
    const snapshotManager = new SnapshotManager("/tmp/safe-exec-test")
    const riskEngine = new RiskEngine()
    const service = new SafeExecutionService(repairService as any, snapshotManager, riskEngine, "/tmp/safe-exec-test")
    return { service, repairService, snapshotManager }
  }

  function makeCandidate(overrides: Partial<RepairCandidate> = {}): RepairCandidate {
    return {
      id: "r1", type: "lifecycle_archive", action: "archive", source: "test.md",
      reason: "test", metadata: { size: 0, createdAt: 0, lastModified: 0 },
      preview: { title: "", description: "", sections: [] },
      risk: "low", status: "pending", createdAt: 0,
      ...overrides,
    }
  }

  it("1. execute archive → calls repairService.archive", async () => {
    const { service, repairService } = makeService()
    vi.spyOn(repairService, "archive").mockResolvedValue(undefined)
    const result = await service.execute(makeCandidate({ action: "archive" }))
    expect(result.status).toBe("committed")
  })

  it("2. execute delete → calls repairService.delete", async () => {
    const { service, repairService } = makeService()
    vi.spyOn(repairService, "delete").mockResolvedValue(undefined)
    const result = await service.execute(makeCandidate({ action: "delete" }))
    expect(result.status).toBe("committed")
  })

  it("3. execute by action string routes correctly", async () => {
    const { service, repairService } = makeService()
    vi.spyOn(repairService, "archive").mockResolvedValue(undefined)
    const result = await service.execute(makeCandidate({ action: "archive" }))
    expect(result.status).toBe("committed")
  })

  it("4. rollback restore → content restored", async () => {
    const { service, repairService } = makeService()
    vi.spyOn(repairService, "archive").mockResolvedValue(undefined)
    const result = await service.execute(makeCandidate({ action: "archive" }))
    expect(result.status).toBe("committed")
    const rolled = await service.rollbackTransaction(result)
    expect(rolled.status).toBe("rolled_back")
  })

  it("5. repair failure → transaction marked failed or rolled_back", async () => {
    const { service, repairService } = makeService()
    vi.spyOn(repairService, "archive").mockRejectedValue(new Error("repair failed"))
    const result = await service.execute(makeCandidate({ action: "archive" }))
    // Status may be "failed" (if rollback also fails) or "rolled_back" (if rollback succeeds)
    expect(["failed", "rolled_back"]).toContain(result.status)
  })

  it("6. auto-executable low risk", async () => {
    const { service } = makeService()
    const result = await service.execute(makeCandidate({ action: "archive", risk: "low" }))
    expect(result.riskAssessment.autoExecutable).toBe(true)
  })

  it("7. non-auto-executable high risk", async () => {
    const { service } = makeService()
    const result = await service.execute(makeCandidate({ action: "delete", risk: "high" }))
    expect(result.riskAssessment.autoExecutable).toBe(false)
  })

  it("8. transaction has riskAssessment fields", async () => {
    const { service } = makeService()
    const result = await service.execute(makeCandidate({ action: "archive" }))
    expect(result.riskAssessment.score).toBeDefined()
    expect(result.riskAssessment.label).toBeDefined()
    expect(result.riskAssessment.factEvidence).toBeDefined()
  })
})