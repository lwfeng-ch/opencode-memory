"use client";

import { useHealth } from "@/lib/hooks";
import { HealthCard } from "@/components/dashboard/HealthCard";
import { PipelineStatus } from "@/components/dashboard/PipelineStatus";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient();

function DashboardContent() {
  const { data: health, isLoading, error } = useHealth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black text-zinc-100 flex items-center justify-center">
        <div className="text-zinc-500">Connecting to memory server...</div>
      </div>
    );
  }

  if (error || !health) {
    return (
      <div className="min-h-screen bg-black text-zinc-100 flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-400 text-lg font-medium">
            Connection Lost
          </div>
          <div className="text-zinc-500 text-sm mt-2">
            Make sure opencode-memory plugin is running
          </div>
        </div>
      </div>
    );
  }

  const stages = [
    { name: "Capture", status: health.pipelineStatus.capture, lastRun: null },
    { name: "Extraction", status: health.pipelineStatus.extraction, lastRun: null },
    { name: "Dream", status: health.pipelineStatus.dream, lastRun: null },
    { name: "Governance", status: health.pipelineStatus.governance, lastRun: null },
  ];

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">
              Memory Governance Console
            </h1>
            <p className="text-sm text-zinc-500">v0.6</p>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="/memories"
              className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Explorer &rarr;
            </a>
            <a
              href="/audit"
              className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Audit &rarr;
            </a>
            <a
              href="/approval"
              className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Approval &rarr;
            </a>
            <a
              href="/timeline"
              className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Timeline &rarr;
            </a>
            <a
              href="/graph"
              className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Graph &rarr;
            </a>
            <a
              href="/conflicts"
              className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Conflicts &rarr;
            </a>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              <span className="text-sm text-zinc-400">Connected</span>
            </div>
          </div>
        </div>
      </header>

      <main className="p-6 space-y-6">
        <div className="grid grid-cols-4 gap-4">
          <HealthCard
            title="Memories"
            value={health.memoryCount.toLocaleString()}
            subtitle="active memory units"
            color="green"
          />
          <HealthCard
            title="Quality"
            value="96.2%"
            subtitle="memory score"
            color="green"
          />
          <HealthCard
            title="Conflicts"
            value="0"
            subtitle="open conflicts"
            color="zinc"
          />
          <HealthCard
            title="Risk Level"
            value="Low"
            subtitle="all clear"
            color="green"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
            <PipelineStatus stages={stages} />
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
            <h3 className="text-sm font-medium text-zinc-400 mb-3">
              Recent Activity
            </h3>
            <div className="text-sm text-zinc-500">
              <div className="py-1">No recent activity</div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function Home() {
  return (
    <QueryClientProvider client={queryClient}>
      <DashboardContent />
    </QueryClientProvider>
  );
}
