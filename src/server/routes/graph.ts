import { Hono } from "hono";

const app = new Hono();

// GET /api/v1/graph — full knowledge graph
app.get("/", async (c) => {
  return c.json({
    nodes: [
      { id: "m1", type: "fact", label: "User prefers Python", data: { confidence: 0.96, source: "conv_0720", status: "active" } },
      { id: "m2", type: "fact", label: "API choice: FastAPI", data: { confidence: 0.91, source: "conv_0720", status: "active" } },
      { id: "m3", type: "semantic", label: "Python developer", data: { confidence: 0.85, source: "dream", status: "active" } },
      { id: "c1", type: "conflict", label: "React vs Vue", data: { status: "open", claimA: "I use React (2025)", claimB: "I use Vue (2026)" } },
      { id: "c2", type: "conflict", label: "Duplicate detected", data: { status: "resolved" } },
      { id: "p1", type: "proposal", label: "Merge #233", data: { action: "merge", risk: "low", status: "approved" } },
      { id: "p2", type: "proposal", label: "Archive #45", data: { action: "archive", risk: "low", status: "pending" } },
      { id: "e1", type: "evidence", label: "Jaccard 0.87", data: { score: 0.87 } },
    ],
    edges: [
      { id: "e1-m1", source: "e1", target: "m1", relation: "supports" },
      { id: "e1-m2", source: "e1", target: "m2", relation: "supports" },
      { id: "m1-m3", source: "m1", target: "m3", relation: "derived_from" },
      { id: "m2-c1", source: "m2", target: "c1", relation: "conflicts" },
      { id: "c1-p1", source: "c1", target: "p1", relation: "results_in" },
    ],
  });
});

// GET /api/v1/graph/memory/:id — subgraph for a specific memory
app.get("/memory/:id", async (c) => {
  const id = c.req.param("id");
  return c.json({
    id,
    nodes: [
      { id: "m1", type: "fact", label: "User prefers Python", data: { confidence: 0.96, source: "conversation_0720", status: "active" } },
      { id: "m2", type: "fact", label: "User likes Python", data: { confidence: 0.82, source: "conversation_0715", status: "archived" } },
      { id: "e1", type: "evidence", label: "Similarity 0.87", data: { score: 0.87 } },
      { id: "c1", type: "conflict", label: "Duplicate detected", data: { status: "resolved" } },
      { id: "p1", type: "proposal", label: "Merge #233", data: { action: "merge", risk: "low", status: "approved" } },
      { id: "x1", type: "execution", label: "Merged", data: { result: "success", timestamp: new Date().toISOString() } },
    ],
    edges: [
      { id: "e1-m1", source: "e1", target: "m1", relation: "supports" },
      { id: "e1-m2", source: "e1", target: "m2", relation: "supports" },
      { id: "m1-c1", source: "m1", target: "c1", relation: "conflicts" },
      { id: "m2-c1", source: "m2", target: "c1", relation: "conflicts" },
      { id: "c1-p1", source: "c1", target: "p1", relation: "results_in" },
      { id: "p1-x1", source: "p1", target: "x1", relation: "results_in" },
    ],
  });
});

export { app as graphRoutes };