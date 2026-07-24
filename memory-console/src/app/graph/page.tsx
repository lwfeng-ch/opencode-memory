"use client";
import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryGraph } from "@/components/graph/MemoryGraph";
import { LiveIndicator } from "@/components/dashboard/LiveIndicator";
import type { Node, Edge } from "@xyflow/react";

const queryClient = new QueryClient();

function GraphContent() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("http://127.0.0.1:4096/api/v1/graph")
      .then((r) => r.json())
      .then((data) => {
        setNodes(data.nodes.map((n: { id: string; type: string; label: string; data: Record<string, unknown> }, i: number) => ({
          id: n.id, type: n.type, position: { x: (i % 3) * 250, y: Math.floor(i / 3) * 180 }, data: { label: n.label, ...n.data },
        })));
        setEdges(data.edges.map((e: { id: string; source: string; target: string; relation: string }) => ({
          id: e.id, source: e.source, target: e.target, style: { stroke: "#ef4444", strokeWidth: e.relation === "conflicts" ? 2 : 1.5 }, animated: e.relation === "conflicts",
        })));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <a href="/" className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors">Dashboard</a>
            <span className="text-zinc-700">/</span>
            <h1 className="text-lg font-semibold">Memory Graph</h1>
          </div>
          <LiveIndicator status={loading ? "reconnecting" : "connected"} lastUpdate={new Date()} />
        </div>
      </header>
      <div className="h-[calc(100vh-57px)]">
        {loading ? <div className="flex items-center justify-center h-full text-zinc-500">Loading graph...</div> : <MemoryGraph initialNodes={nodes} initialEdges={edges} />}
      </div>
    </div>
  );
}

export default function GraphPage() { return <QueryClientProvider client={queryClient}><GraphContent /></QueryClientProvider>; }