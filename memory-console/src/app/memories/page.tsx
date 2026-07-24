"use client";

import { useState } from "react";
import { useMemories } from "@/lib/hooks";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryCard } from "@/components/memory/MemoryCard";
import { MemoryDetail } from "@/components/memory/MemoryDetail";
import { MemoryFilter } from "@/components/memory/MemoryFilter";
import type { FilterState } from "@/components/memory/MemoryFilter";
import type { MemoryHeader } from "@/types/api";

const queryClient = new QueryClient();

const defaultFilter: FilterState = {
  scope: "",
  type: "",
  status: "",
  search: "",
};

function ExplorerContent() {
  const [filter, setFilter] = useState<FilterState>(defaultFilter);
  const [selected, setSelected] = useState<MemoryHeader | null>(null);
  const [detailData, setDetailData] = useState<unknown>(null);

  const { data, isLoading, error } = useMemories({
    scope: filter.scope || undefined,
    type: filter.type || undefined,
    search: filter.search || undefined,
  });

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Memory Explorer</h1>
            <p className="text-sm text-zinc-500">
              Browse and inspect all memories
            </p>
          </div>
          <a
            href="/"
            className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            &larr; Dashboard
          </a>
        </div>
      </header>

      <div className="p-6 space-y-4">
        <MemoryFilter filter={filter} onChange={setFilter} />

        <div className="grid grid-cols-[1fr_400px] gap-6">
          <div className="space-y-2">
            {isLoading && (
              <div className="text-sm text-zinc-500">Loading...</div>
            )}
            {error && (
              <div className="text-sm text-red-400">
                Failed to load memories
              </div>
            )}
            {data?.memories.map((memory) => (
              <MemoryCard
                key={memory.filename}
                memory={memory}
                selected={selected?.filename === memory.filename}
                onSelect={() => setSelected(memory)}
              />
            ))}
            {data?.memories.length === 0 && (
              <div className="text-sm text-zinc-500 text-center py-8">
                No memories found
              </div>
            )}
          </div>

          <div className="sticky top-6">
            {detailData ? (
              <MemoryDetail
                memory={detailData as any}
                onClose={() => {
                  setDetailData(null);
                  setSelected(null);
                }}
              />
            ) : selected ? (
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
                <p className="text-sm text-zinc-500">
                  Select a memory to view details
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
                <p className="text-sm text-zinc-500">
                  Select a memory to view details
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ExplorerPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <ExplorerContent />
    </QueryClientProvider>
  );
}
