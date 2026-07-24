import { Hono } from "hono";

const app = new Hono();

// GET /api/v1/pipeline/sessions
app.get("/sessions", async (c) => {
  return c.json({
    sessions: [
      { id: "ses_001", startedAt: new Date(Date.now() - 3600000).toISOString(), status: "completed", stages: [
        { name: "system.transform", status: "completed", latencyMs: 12, lastRun: "2s ago" },
        { name: "chat.message", status: "completed", latencyMs: 8, lastRun: "30s ago" },
        { name: "tool.execute.after", status: "completed", latencyMs: 3, lastRun: "15s ago" },
        { name: "session.idle", status: "completed", latencyMs: 2300, lastRun: "5m ago" },
      ]},
      { id: "ses_002", startedAt: new Date(Date.now() - 7200000).toISOString(), status: "running", stages: [
        { name: "system.transform", status: "completed", latencyMs: 15, lastRun: "1m ago" },
        { name: "chat.message", status: "completed", latencyMs: 6, lastRun: "45s ago" },
        { name: "tool.execute.after", status: "running", latencyMs: 0, lastRun: "now" },
        { name: "session.idle", status: "waiting", latencyMs: 0, lastRun: null },
      ]},
      { id: "ses_003", startedAt: new Date(Date.now() - 10800000).toISOString(), status: "completed", stages: [
        { name: "system.transform", status: "completed", latencyMs: 10, lastRun: "1h ago" },
        { name: "chat.message", status: "completed", latencyMs: 7, lastRun: "1h ago" },
        { name: "tool.execute.after", status: "completed", latencyMs: 4, lastRun: "1h ago" },
        { name: "session.idle", status: "completed", latencyMs: 1800, lastRun: "1h ago" },
      ]},
    ],
    total: 3,
  });
});

// GET /api/v1/pipeline/sessions/:id
app.get("/sessions/:id", async (c) => {
  return c.json({
    id: "ses_001", status: "completed",
    startedAt: new Date(Date.now() - 3600000).toISOString(),
    stages: [
      { name: "system.transform", status: "completed", latencyMs: 12, lastRun: "2s ago", detail: { tokens: { input: 1245, output: 0 }, model: "deepseek-v4-flash" } },
      { name: "chat.message", status: "completed", latencyMs: 8, lastRun: "30s ago", detail: { query: "What framework do I use?", recallHit: true } },
      { name: "tool.execute.after", status: "completed", latencyMs: 3, lastRun: "15s ago", detail: { tool: "memory_save", success: true } },
      { name: "session.idle", status: "completed", latencyMs: 2300, lastRun: "5m ago", detail: { phases: { capture: "45ms", extraction: "2.3s", dream: "skipped" } } },
    ],
  });
});

// GET /api/v1/pipeline/status
app.get("/status", async (c) => {
  return c.json({
    capture: { status: "running", lastRun: "2m ago", uptime: "99.9%" },
    extraction: { status: "healthy", lastRun: "15m ago", totalExtractions: 47, avgLatencyMs: 2100 },
    dream: { status: "idle", lastRun: "3h ago", totalRuns: 12, lastError: null },
    governance: { status: "waiting", lastRun: "10m ago", totalActions: 47, nextRun: "20m" },
  });
});

export { app as pipelineRoutes };