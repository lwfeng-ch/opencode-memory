"use client";

import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { MemoryTimeline } from "@/components/timeline/MemoryTimeline";
import { LiveIndicator } from "@/components/dashboard/LiveIndicator";

const queryClient = new QueryClient();

function TimelineContent() {
  const { data: memories } = useQuery({
    queryKey: ["memories"],
    queryFn: async () => {
      const res = await fetch("http://127.0.0.1:4096/api/v1/memories");
      return res.json();
    },
  });

  const { data: historyData } = useQuery({
    queryKey: ["memory-history"],
    queryFn: async () => {
      if (!memories?.memories?.length) return {};
      const entries: Record<string, unknown> = {};
      for (const m of memories.memories.slice(0, 10)) {
        const res = await fetch(`http://127.0.0.1:4096/api/v1/memories/${encodeURIComponent(m.filename)}/history`);
        if (res.ok) entries[m.filename] = await res.json();
      }
      return entries;
    },
    enabled: !!memories?.memories?.length,
  });

  const items = memories?.memories ?? [];

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <a href="/" className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors">Dashboard</a>
            <span className="text-zinc-700">/</span>
            <h1 className="text-lg font-semibold">Memory Timeline</h1>
          </div>
          <LiveIndicator status="connected" lastUpdate={new Date()} />
        </div>
      </header>
      <main className="p-6">
        {!items.length ? (
          <div className="text-sm text-zinc-500">No memories to display</div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {items.slice(0, 10).map((m: { filename: string; name: string; status: string }) => {
              const history = historyData?.[m.filename] as { events?: Array<{ action: string; timestamp: number; actor: string; detail?: string }> } | undefined;
              const events = history?.events?.length
                ? history.events.map((e) => ({
                    action: e.action,
                    timestamp: new Date(e.timestamp).toISOString(),
                    actor: e.actor,
                    detail: e.detail,
                  }))
                : [{ action: "create", timestamp: new Date().toISOString(), actor: "extraction", detail: "Initial creation" }];
              return <MemoryTimeline key={m.filename} memoryName={m.name || m.filename} events={events} isActive={m.status === "active"} />;
            })}
          </div>
        )}
      </main>
    </div>
  );
}

export default function TimelinePage() {
  return (
    <QueryClientProvider client={queryClient}>
      <TimelineContent />
    </QueryClientProvider>
  );
}
