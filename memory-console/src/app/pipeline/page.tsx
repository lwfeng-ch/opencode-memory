"use client";
import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LiveIndicator } from "@/components/dashboard/LiveIndicator";

const queryClient = new QueryClient();

const statusColors: Record<string, string> = { completed: "bg-green-500", running: "bg-blue-500 animate-pulse", waiting: "bg-zinc-500", idle: "bg-zinc-500", error: "bg-red-500" };

function PipelineContent() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("http://127.0.0.1:4096/api/v1/pipeline/sessions")
      .then((r) => r.json()).then((d) => { setSessions(d.sessions); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const sel = sessions.find((s) => s.id === selectedId) ?? sessions[0];

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <a href="/" className="text-sm text-zinc-500 hover:text-zinc-300">Dashboard</a>
            <span className="text-zinc-700">/</span>
            <h1 className="text-lg font-semibold">Pipeline Trace</h1>
          </div>
          <LiveIndicator status={loading ? "reconnecting" : "connected"} lastUpdate={new Date()} />
        </div>
      </header>
      <div className="flex h-[calc(100vh-57px)]">
        <div className="w-64 border-r border-zinc-800 overflow-y-auto flex-shrink-0 p-2 space-y-1">
          {sessions.map((s) => (
            <button key={s.id} onClick={() => setSelectedId(s.id)}
              className={`w-full text-left p-2 rounded text-xs transition-colors ${selectedId === s.id ? "bg-zinc-800" : "hover:bg-zinc-800/50"}`}>
              <div className="text-zinc-300 font-medium">{s.id}</div>
              <div className="text-zinc-500">{s.status} · {new Date(s.startedAt).toLocaleTimeString()}</div>
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {sel && (
            <div className="max-w-2xl space-y-4">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-sm text-zinc-400">Session {sel.id}</span>
                <span className="text-xs text-zinc-500">· {sel.status}</span>
              </div>
              {sel.stages.map((stage: any, i: number) => (
                <div key={i} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div className={`w-3 h-3 rounded-full ${statusColors[stage.status] ?? "bg-zinc-500"}`} />
                    {i < sel.stages.length - 1 && <div className="w-px flex-1 bg-zinc-800 min-h-[40px]" />}
                  </div>
                  <div className="flex-1 pb-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-zinc-200">{stage.name}</span>
                      <span className="text-xs text-zinc-500">{stage.status} · {stage.latencyMs ? `${stage.latencyMs}ms` : "—"}</span>
                    </div>
                    <div className="text-xs text-zinc-500 mt-1">{stage.lastRun ?? "pending"}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PipelinePage() { return <QueryClientProvider client={queryClient}><PipelineContent /></QueryClientProvider>; }