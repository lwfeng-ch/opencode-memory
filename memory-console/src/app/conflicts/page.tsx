"use client";
import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RiskBadge } from "@/components/governance/RiskBadge";
import { LiveIndicator } from "@/components/dashboard/LiveIndicator";

const queryClient = new QueryClient();

interface Conflict {
  id: string; status: string;
  claimA: { text: string; timestamp: string; source: string; confidence: number };
  claimB: { text: string; timestamp: string; source: string; confidence: number };
  resolution: { strategy: string; confidence: number; explanation: string };
}

function ConflictsContent() {
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    fetch("http://127.0.0.1:4096/api/v1/conflicts")
      .then((r) => r.json()).then((d) => { setConflicts(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const sel = conflicts.find((c) => c.id === selected);

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <a href="/" className="text-sm text-zinc-500 hover:text-zinc-300">Dashboard</a>
            <span className="text-zinc-700">/</span>
            <h1 className="text-lg font-semibold">Conflict Resolution</h1>
            <span className="text-xs text-red-400">{conflicts.filter((c) => c.status === "open").length} open</span>
          </div>
          <LiveIndicator status={loading ? "reconnecting" : "connected"} lastUpdate={new Date()} />
        </div>
      </header>
      <div className="flex h-[calc(100vh-57px)]">
        <div className="w-80 border-r border-zinc-800 overflow-y-auto flex-shrink-0 p-2 space-y-1">
          {conflicts.map((c) => (
            <button key={c.id} onClick={() => setSelected(c.id)}
              className={`w-full text-left p-3 rounded border transition-colors ${selected === c.id ? "bg-zinc-800 border-zinc-700" : "bg-transparent border-transparent hover:bg-zinc-800/50"}`}>
              <div className="text-xs text-red-400 font-medium">Conflict #{c.id}</div>
              <div className="text-xs text-zinc-400 mt-1 truncate">{c.claimA.text} vs {c.claimB.text}</div>
              <div className="text-[10px] text-zinc-500 mt-1">{c.status === "open" ? "\u25CF Open" : "\u25CF Resolved"}</div>
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {!sel ? (
            <div className="text-zinc-500 text-sm">Select a conflict to resolve</div>
          ) : (
            <div className="max-w-3xl space-y-6">
              <div className="grid grid-cols-2 gap-6">
                <div className="bg-zinc-900/50 rounded-lg p-4 border border-red-500/20">
                  <div className="text-xs text-red-400 uppercase mb-2">Claim A</div>
                  <div className="text-lg font-medium text-zinc-100">{sel.claimA.text}</div>
                  <div className="text-xs text-zinc-500 mt-2">Source: {sel.claimA.source}</div>
                  <div className="text-xs text-zinc-500">Date: {new Date(sel.claimA.timestamp).toLocaleDateString()}</div>
                  <div className="text-xs text-zinc-500">Confidence: {(sel.claimA.confidence * 100).toFixed(0)}%</div>
                </div>
                <div className="bg-zinc-900/50 rounded-lg p-4 border border-blue-500/20">
                  <div className="text-xs text-blue-400 uppercase mb-2">Claim B</div>
                  <div className="text-lg font-medium text-zinc-100">{sel.claimB.text}</div>
                  <div className="text-xs text-zinc-500 mt-2">Source: {sel.claimB.source}</div>
                  <div className="text-xs text-zinc-500">Date: {new Date(sel.claimB.timestamp).toLocaleDateString()}</div>
                  <div className="text-xs text-zinc-500">Confidence: {(sel.claimB.confidence * 100).toFixed(0)}%</div>
                </div>
              </div>
              <div className="bg-blue-950/30 border border-blue-900/30 rounded-lg p-4">
                <h3 className="text-xs font-medium text-blue-400 uppercase tracking-wider mb-2">AI Resolution</h3>
                <div className="text-sm text-zinc-300">{sel.resolution.explanation}</div>
                <div className="flex items-center gap-2 mt-2 text-xs">
                  <span className="text-zinc-500">Strategy:</span>
                  <span className="text-zinc-300">{sel.resolution.strategy.replace(/_/g, " ")}</span>
                  <span className="text-zinc-600">\u00B7</span>
                  <span className="text-zinc-500">Confidence:</span>
                  <span className="text-green-400">{(sel.resolution.confidence * 100).toFixed(0)}%</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ConflictsPage() { return <QueryClientProvider client={queryClient}><ConflictsContent /></QueryClientProvider>; }
