import { Hono } from "hono";

const app = new Hono();

// GET /api/v1/conflicts
app.get("/", async (c) => {
  return c.json([
    {
      id: "c1", status: "open",
      claimA: { text: "I use React", timestamp: "2025-01-15T00:00:00Z", source: "conversation_20250115", confidence: 0.91 },
      claimB: { text: "I use Vue", timestamp: "2026-01-20T00:00:00Z", source: "conversation_20260120", confidence: 0.88 },
      resolution: { strategy: "newest_evidence_wins", confidence: 0.92, explanation: "Claim B is 12 months newer. Both have high confidence. Temporal recency is the decisive factor." },
    },
    {
      id: "c2", status: "open",
      claimA: { text: "Database: PostgreSQL", timestamp: "2025-06-01T00:00:00Z", source: "conversation_20250601", confidence: 0.95 },
      claimB: { text: "Database: SQLite", timestamp: "2025-06-15T00:00:00Z", source: "conversation_20250615", confidence: 0.72 },
      resolution: { strategy: "highest_confidence_wins", confidence: 0.95, explanation: "PostgreSQL has higher confidence (0.95 vs 0.72). SQLite was mentioned as a development-only option." },
    },
    {
      id: "c3", status: "resolved",
      claimA: { text: "Python 3.10", timestamp: "2025-03-01T00:00:00Z", source: "conversation_20250301", confidence: 0.89 },
      claimB: { text: "Python 3.12", timestamp: "2025-09-01T00:00:00Z", source: "conversation_20250901", confidence: 0.93 },
      resolution: { strategy: "newest_evidence_wins", confidence: 0.93, explanation: "Resolved: Python 3.12. Newer + higher confidence." },
    },
  ]);
});

// GET /api/v1/conflicts/:id
app.get("/:id", async (c) => {
  return c.json({
    id: "c1", status: "open",
    claimA: { text: "I use React", timestamp: "2025-01-15T00:00:00Z", source: "conversation_20250115", confidence: 0.91 },
    claimB: { text: "I use Vue", timestamp: "2026-01-20T00:00:00Z", source: "conversation_20260120", confidence: 0.88 },
    resolution: { strategy: "newest_evidence_wins", confidence: 0.92, explanation: "Claim B is 12 months newer. Both have high confidence. Temporal recency is the decisive factor." },
    timeline: [
      { date: "2025-01-15", event: "Claim A created (React)", type: "claim" },
      { date: "2026-01-20", event: "Claim B created (Vue)", type: "claim" },
      { date: "2026-01-21", event: "Conflict detected by ConflictGraph", type: "detection" },
      { date: "2026-01-21", event: "Resolution proposed: newest evidence wins", type: "resolution" },
    ],
  });
});

// POST /api/v1/conflicts/:id/resolve
app.post("/:id/resolve", async (c) => {
  return c.json({ success: true, id: c.req.param("id"), status: "resolved" });
});

export { app as conflictRoutes };
