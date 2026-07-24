import { Hono } from "hono";

/**
 * Register all governance-related routes on the main app.
 *
 * - /api/v1/governance/proposals* — proposal CRUD
 * - /api/v1/audit/events          — audit event log (top-level)
 * - /api/v1/events                — SSE live events (top-level)
 */
export function registerGovernanceRoutes(app: Hono): void {
  // ── Governance proposals (sub-routes) ──────────────────────────
  const gov = new Hono();

  // GET /api/v1/governance/proposals
  gov.get("/proposals", async (c) => {
    return c.json([
      {
        id: "p001",
        type: "merge",
        targetMemory: "User prefers Python",
        reason:
          "Duplicate memory detected (Jaccard similarity 0.87)",
        confidence: 0.94,
        risk: "low",
        status: "pending",
        evidence: [
          {
            id: "mem_001",
            label: "Memory: User likes Python",
            score: 0.87,
          },
          {
            id: "mem_002",
            label: "Memory: User prefers Python",
            score: 0.87,
          },
        ],
        before:
          "Fact A: User likes Python\nFact B: User prefers Python",
        after:
          "Merged: User prefers Python (confidence: 0.94)",
        createdAt: new Date().toISOString(),
        createdBy: "discovery",
        riskFactors: {
          impact: 0.2,
          blastRadius: 0.1,
          reversibility: 0.9,
        },
        aiExplanation: {
          summary:
            "Two memories express the same preference with different wording. Jaccard similarity 0.87 exceeds merge threshold of 0.8.",
          recommendation: "MERGE",
          confidenceBreakdown: {
            textSimilarity: 0.87,
            temporalProximity: 0.95,
            sourceTrust: 0.9,
          },
        },
      },
      {
        id: "p002",
        type: "archive",
        targetMemory: "Session notes 2026-07-15",
        reason:
          "Session memory exceeding 30-day threshold, last recalled 45 days ago",
        confidence: 0.82,
        risk: "low",
        status: "pending",
        evidence: [
          {
            id: "mem_003",
            label: "Session: 2026-07-15",
            score: 0.75,
          },
        ],
        before:
          "Status: active\nRecall count: 0\nLast recalled: never",
        after:
          "Status: archived\nReason: 30-day threshold exceeded",
        createdAt: new Date(
          Date.now() - 3600000,
        ).toISOString(),
        createdBy: "governance",
        riskFactors: {
          impact: 0.1,
          blastRadius: 0.05,
          reversibility: 1.0,
        },
        aiExplanation: {
          summary:
            "Session memory has not been recalled since creation. Archiving is low-risk and fully reversible.",
          recommendation: "ARCHIVE",
          confidenceBreakdown: {
            stalenessScore: 0.92,
            recallHistory: 0.85,
            contentValue: 0.7,
          },
        },
      },
      {
        id: "p003",
        type: "delete",
        targetMemory: "Obsolete config fact",
        reason:
          "Memory never recalled in 180 days, derived from obsolete session",
        confidence: 0.71,
        risk: "medium",
        status: "pending",
        evidence: [
          {
            id: "mem_045",
            label: "Memory: legacy API config",
            score: 0.65,
          },
        ],
        before:
          "Content: use legacy API endpoint\nConfidence: inferred\nSource: session_20260101",
        after:
          "Deleted via RepairService (requires snapshot backup)",
        createdAt: new Date(
          Date.now() - 7200000,
        ).toISOString(),
        createdBy: "discovery",
        riskFactors: {
          impact: 0.6,
          blastRadius: 0.3,
          reversibility: 0.4,
        },
        aiExplanation: {
          summary:
            "Memory is 180+ days old, never recalled, and references a deprecated API. Medium risk due to potential downstream dependencies.",
          recommendation: "DELETE with caution",
          confidenceBreakdown: {
            stalenessScore: 0.95,
            recallHistory: 0.98,
            dependencyRisk: 0.4,
          },
        },
      },
    ]);
  });

  // POST /api/v1/governance/proposals/:id/approve
  gov.post("/proposals/:id/approve", async (c) => {
    const id = c.req.param("id");
    return c.json({
      success: true,
      id,
      status: "approved",
      executedAt: new Date().toISOString(),
    });
  });

  // POST /api/v1/governance/proposals/:id/reject
  gov.post("/proposals/:id/reject", async (c) => {
    const id = c.req.param("id");
    return c.json({ success: true, id, status: "rejected" });
  });

  app.route("/api/v1/governance", gov);

  // ── Audit event log (top-level, NOT under /governance) ────────
  app.get("/api/v1/audit/events", async (c) => {
    return c.json({
      events: [
        {
          id: "a001",
          action: "ARCHIVE",
          actor: "Governance",
          risk: "low",
          result: "success",
          timestamp: new Date().toISOString(),
          detail: "Archived stale session memory",
          snapshotHash: "sha256:abc123",
        },
        {
          id: "a002",
          action: "APPROVE",
          actor: "User",
          risk: "low",
          result: "success",
          timestamp: new Date(
            Date.now() - 600000,
          ).toISOString(),
          detail: "Approved merge proposal #233",
          snapshotHash: null,
        },
        {
          id: "a003",
          action: "PROPOSE",
          actor: "Discovery",
          risk: "low",
          result: "success",
          timestamp: new Date(
            Date.now() - 1200000,
          ).toISOString(),
          detail:
            "Created merge proposal for duplicate memory",
          snapshotHash: null,
        },
        {
          id: "a004",
          action: "CONFLICT",
          actor: "Detection",
          risk: "medium",
          result: "success",
          timestamp: new Date(
            Date.now() - 1800000,
          ).toISOString(),
          detail:
            "Detected conflict: React vs Vue preference",
          snapshotHash: null,
        },
        {
          id: "a005",
          action: "MERGE",
          actor: "Governance",
          risk: "low",
          result: "success",
          timestamp: new Date(
            Date.now() - 3600000,
          ).toISOString(),
          detail:
            "Merged duplicate fact #1018 into #1024",
          snapshotHash: "sha256:def456",
        },
        {
          id: "a006",
          action: "ROLLBACK",
          actor: "User",
          risk: "medium",
          result: "success",
          timestamp: new Date(
            Date.now() - 7200000,
          ).toISOString(),
          detail: "Rolled back merge #233 via snapshot",
          snapshotHash: "sha256:abc123",
        },
      ],
      total: 6,
      page: 1,
      pageSize: 20,
    });
  });

  // ── SSE live events (top-level) ────────────────────────────────
  app.get("/api/v1/events", async (c) => {
    c.header("Content-Type", "text/event-stream");
    c.header("Cache-Control", "no-cache");
    c.header("Connection", "keep-alive");

    const stream = new ReadableStream({
      start(controller) {
        // Send initial keepalive
        const encoder = new TextEncoder();
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "connected", timestamp: new Date().toISOString() })}\n\n`,
          ),
        );

        // Send heartbeat every 30s
        const heartbeat = setInterval(() => {
          controller.enqueue(
            encoder.encode(`: heartbeat\n\n`),
          );
        }, 30000);

        // Cleanup on cancel
        c.req.raw.signal.addEventListener("abort", () => {
          clearInterval(heartbeat);
          controller.close();
        });
      },
    });

    return c.body(stream);
  });
}
