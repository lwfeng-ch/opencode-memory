"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { AuditFilter } from "@/components/audit/AuditFilter";
import { AuditTable } from "@/components/audit/AuditTable";
import { AuditDetailDrawer } from "@/components/audit/AuditDetailDrawer";
import { LiveIndicator } from "@/components/dashboard/LiveIndicator";
import type { AuditEvent, AuditResponse } from "@/types/governance";

const queryClient = new QueryClient();

function AuditContent() {
  const [search, setSearch] = useState("");
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
  const { data } = useQuery<AuditResponse>({
    queryKey: ["audit"],
    queryFn: async () => {
      const res = await fetch("http://127.0.0.1:5173/api/v1/audit/events");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const events = data?.events ?? [];
  const filtered = search
    ? events.filter((e: AuditEvent) =>
        [e.action, e.actor, e.detail].some((f) => f.toLowerCase().includes(search.toLowerCase())))
    : events;

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <a href="/" className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors">Dashboard</a>
            <span className="text-zinc-700">/</span>
            <h1 className="text-lg font-semibold">Audit Logs</h1>
            <span className="text-sm text-zinc-500">{data?.total ?? 0} events</span>
          </div>
          <LiveIndicator status="connected" lastUpdate={new Date()} />
        </div>
      </header>
      <div className="flex h-[calc(100vh-57px)]">
        <div className="w-56 border-r border-zinc-800 flex-shrink-0">
          <AuditFilter search={search} onSearchChange={setSearch} />
        </div>
        <div className="flex-1 overflow-y-auto">
          <AuditTable events={filtered} onSelect={setSelectedEvent} />
        </div>
      </div>
      <AuditDetailDrawer event={selectedEvent} open={!!selectedEvent} onClose={() => setSelectedEvent(null)} />
    </div>
  );
}

export default function AuditPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuditContent />
    </QueryClientProvider>
  );
}
