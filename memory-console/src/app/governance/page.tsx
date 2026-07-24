"use client";
import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RiskBadge } from "@/components/governance/RiskBadge";
import { LiveIndicator } from "@/components/dashboard/LiveIndicator";

const queryClient = new QueryClient();

interface PipelineStatus { capture: any; extraction: any; dream: any; governance: any; }

function GovernanceContent() {
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("http://127.0.0.1:4096/api/v1/pipeline/status")
      .then((r) => r.json()).then((d) => { setStatus(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <a href="/" className="text-sm text-zinc-500 hover:text-zinc-300">Dashboard</a>
            <span className="text-zinc-700">/</span>
            <h1 className="text-lg font-semibold">Governance Center</h1>
          </div>
          <LiveIndicator status={loading ? "reconnecting" : "connected"} lastUpdate={new Date()} />
        </div>
      </header>
      <main className="p-6 max-w-4xl space-y-6">
        {/* Scheduler Status */}
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-zinc-500 uppercase tracking-wider">Scheduler</span>
              <div className="flex items-center gap-2 mt-1">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-sm font-medium text-zinc-100">ACTIVE</span>
              </div>
            </div>
            <div className="text-right text-xs text-zinc-500">
              {status?.governance && (
                <>
                  <div>Last: {status.governance.lastRun}</div>
                  <div>Next: {status.governance.nextRun}</div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Safety Guards */}
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-3">Safety Guards</h3>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Enabled", checked: true },
              { label: "Auto Execution", checked: true },
              { label: "Risk Threshold: 0.3", checked: true },
              { label: "Max Actions: 5", checked: true },
            ].map((g) => (
              <div key={g.label} className="flex items-center gap-2 text-sm">
                <span className="text-green-400">{g.checked ? "✓" : "○"}</span>
                <span className="text-zinc-300">{g.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Governance Pipeline */}
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-3">Governance Pipeline</h3>
          <div className="flex items-center justify-between text-xs">
            {["Scan", "Discover", "Risk", "Approve", "Execute"].map((step, i) => (
              <div key={step} className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400">{i + 1}</div>
                <span className="text-zinc-400">{step}</span>
                {i < 4 && <span className="text-zinc-700">→</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Pipeline Status Cards */}
        <div className="grid grid-cols-2 gap-4">
          {status && Object.entries(status).map(([key, val]: [string, any]) => (
            <div key={key} className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
              <div className="text-xs text-zinc-500 capitalize">{key}</div>
              <div className="flex items-center gap-2 mt-1">
                <span className={`w-2 h-2 rounded-full ${val.status === "running" || val.status === "healthy" ? "bg-green-500" : "bg-zinc-500"}`} />
                <span className="text-sm font-medium text-zinc-200">{val.status}</span>
              </div>
              <div className="text-xs text-zinc-500 mt-1">Last: {val.lastRun}</div>
            </div>
          ))}
        </div>

        {/* Recent Runs Summary */}
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-3">Recent Runs</h3>
          {[
            { run: "#12", candidates: 5, executed: 3, skipped: 2, time: "10m ago" },
            { run: "#11", candidates: 2, executed: 0, skipped: 0, time: "1h ago" },
            { run: "#10", candidates: 7, executed: 4, skipped: 1, time: "3h ago" },
          ].map((r) => (
            <div key={r.run} className="flex items-center justify-between py-1.5 text-xs border-b border-zinc-800/50 last:border-0">
              <span className="text-zinc-400">Run {r.run}</span>
              <span className="text-zinc-500">{r.candidates} candidates · {r.executed} executed · {r.skipped} skipped</span>
              <span className="text-zinc-600">{r.time}</span>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

export default function GovernancePage() { return <QueryClientProvider client={queryClient}><GovernanceContent /></QueryClientProvider>; }