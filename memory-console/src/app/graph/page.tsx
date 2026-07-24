"use client";
import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryGraph } from "@/components/graph/MemoryGraph";
import type { Node, Edge } from "@xyflow/react";

const queryClient = new QueryClient();

/* ── Legend Item ────────────────────────────────────────── */
function LegendItem({ color, label, desc }: { color: string; label: string; desc: string }) {
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <div className="mt-0.5 h-3 w-3 rounded-sm flex-shrink-0" style={{ backgroundColor: color }} />
      <div>
        <div className="text-[12px] font-medium text-zinc-200">{label}</div>
        <div className="text-[10px] text-zinc-500 leading-snug">{desc}</div>
      </div>
    </div>
  );
}

/* ─ Nav Link ───────────────────────────────────────────── */
function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className="group relative text-[12px] text-zinc-500 transition-colors hover:text-zinc-200">
      {children}
      <span className="absolute -bottom-1 left-0 h-px w-0 bg-zinc-400 transition-all duration-300 group-hover:w-full" />
    </a>
  );
}

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
          id: e.id, source: e.source, target: e.target, style: { stroke: e.relation === "conflicts" ? "#ef4444" : "#3b82f6", strokeWidth: e.relation === "conflicts" ? 2 : 1.5 }, animated: e.relation === "conflicts",
        })));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="relative min-h-screen bg-[#09090b] bg-dot-grid">
      <div className="fixed inset-0 bg-radial-glow pointer-events-none" />
      <div className="relative z-10 flex flex-col h-screen">
        {/* Header */}
        <header className="border-b border-white/[0.04] px-6 py-4 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-baseline gap-3">
              <h1 className="font-[family-name:var(--font-sora)] text-lg font-bold tracking-tight text-zinc-100">MemoryOS</h1>
              <span className="text-[10px] font-medium text-zinc-600 tracking-wide">MEMORY GRAPH</span>
            </div>
            <nav className="flex items-center gap-3 text-[12px]">
              <NavLink href="/">Dashboard</NavLink>
              <NavLink href="/memories">Explorer</NavLink>
              <NavLink href="/approval">Approval</NavLink>
              <NavLink href="/timeline">Timeline</NavLink>
              <NavLink href="/conflicts">Conflicts</NavLink>
              <NavLink href="/pipeline">Pipeline</NavLink>
              <NavLink href="/audit">Audit</NavLink>
              <NavLink href="/governance">Governance</NavLink>
            </nav>
          </div>
        </header>

        {/* Main: Graph + Sidebar */}
        <div className="flex flex-1 min-h-0">
          {/* Graph Canvas */}
          <div className="flex-1 relative">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <div className="flex flex-col items-center gap-3">
                  <div className="h-8 w-8 rounded-full border-2 border-zinc-700 border-t-blue-500 animate-spin" />
                  <span className="text-sm text-zinc-600 font-[family-name:var(--font-mono)]">loading graph…</span>
                </div>
              </div>
            ) : nodes.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <div className="text-zinc-400 text-sm font-[family-name:var(--font-sora)]">No graph data</div>
                  <div className="text-zinc-600 text-xs mt-1">Connect to API server to view memory relationships</div>
                </div>
              </div>
            ) : (
              <MemoryGraph initialNodes={nodes} initialEdges={edges} />
            )}
          </div>

          {/* Right Sidebar: Legend + Info */}
          <div className="w-72 border-l border-white/[0.06] bg-white/[0.01] flex-shrink-0 overflow-y-auto">
            <div className="p-5 space-y-5">
              {/* Description */}
              <div>
                <h3 className="font-[family-name:var(--font-sora)] text-xs font-semibold text-zinc-300 tracking-wide mb-2">About This Graph</h3>
                <p className="text-[11px] text-zinc-500 leading-relaxed">
                  Visualizes relationships between memories, evidence, conflicts, proposals, and executions.
                  Click any node to inspect details. Drag to pan, scroll to zoom.
                </p>
              </div>

              {/* Node Types Legend */}
              <div>
                <h3 className="font-[family-name:var(--font-sora)] text-xs font-semibold text-zinc-300 tracking-wide mb-2">Node Types</h3>
                <div className="space-y-0.5">
                  <LegendItem color="#3b82f6" label="Memory (Fact/Semantic)" desc="Core memory units with confidence scores" />
                  <LegendItem color="#ef4444" label="Conflict" desc="Contradictory claims requiring resolution" />
                  <LegendItem color="#a855f7" label="Evidence" desc="Supporting data with similarity scores" />
                  <LegendItem color="#f59e0b" label="Proposal" desc="Governance actions pending approval" />
                  <LegendItem color="#22c55e" label="Execution" desc="Completed governance operations" />
                </div>
              </div>

              {/* Edge Types Legend */}
              <div>
                <h3 className="font-[family-name:var(--font-sora)] text-xs font-semibold text-zinc-300 tracking-wide mb-2">Edge Types</h3>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-px bg-zinc-500" />
                    <span className="text-[10px] text-zinc-500">derived_from</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-px border-t border-dashed border-emerald-500/60" />
                    <span className="text-[10px] text-zinc-500">supports</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-0.5 bg-red-500" />
                    <span className="text-[10px] text-zinc-500">conflicts</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-px border-t border-dashed border-blue-500/60" />
                    <span className="text-[10px] text-zinc-500">results_in</span>
                  </div>
                </div>
              </div>

              {/* Stats */}
              <div>
                <h3 className="font-[family-name:var(--font-sora)] text-xs font-semibold text-zinc-300 tracking-wide mb-2">Graph Stats</h3>
                <div className="space-y-1.5 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Nodes</span>
                    <span className="font-[family-name:var(--font-mono)] text-zinc-300">{nodes.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Edges</span>
                    <span className="font-[family-name:var(--font-mono)] text-zinc-300">{edges.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Conflicts</span>
                    <span className="font-[family-name:var(--font-mono)] text-red-400">{nodes.filter(n => n.type === "conflict").length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Pending</span>
                    <span className="font-[family-name:var(--font-mono)] text-amber-400">{nodes.filter(n => n.type === "proposal").length}</span>
                  </div>
                </div>
              </div>

              {/* Controls Help */}
              <div>
                <h3 className="font-[family-name:var(--font-sora)] text-xs font-semibold text-zinc-300 tracking-wide mb-2">Controls</h3>
                <div className="space-y-1 text-[10px] text-zinc-500">
                  <div>• Click node → inspect details</div>
                  <div>• Scroll → zoom in/out</div>
                  <div>• Drag canvas → pan view</div>
                  <div>• Double-click → fit all nodes</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function GraphPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <GraphContent />
    </QueryClientProvider>
  );
}