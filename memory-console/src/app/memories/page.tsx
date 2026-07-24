"use client";

import { useState } from "react";
import { useMemories } from "@/lib/hooks";
import { MemoryCard } from "@/components/memory/MemoryCard";
import { MemoryDetail } from "@/components/memory/MemoryDetail";
import { MemoryFilter } from "@/components/memory/MemoryFilter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient();

function ExplorerContent() {
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState("all");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const { data, isLoading } = useMemories({ search: search || undefined, scope: scope !== "all" ? scope : undefined });

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="flex items-center gap-4">
          <a href="/" className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors">Dashboard</a>
          <span className="text-zinc-700">/</span>
          <h1 className="text-lg font-semibold">Memory Explorer</h1>
        </div>
      </header>
      <div className="flex h-[calc(100vh-57px)]">
        <div className="w-56 border-r border-zinc-800 flex-shrink-0">
          <MemoryFilter search={search} onSearchChange={setSearch} scope={scope} onScopeChange={setScope} />
        </div>
        <div className="w-72 border-r border-zinc-800 overflow-y-auto flex-shrink-0">
          {isLoading ? (
            <div className="p-4 text-sm text-zinc-500">Loading...</div>
          ) : !data?.memories.length ? (
            <div className="p-4 text-sm text-zinc-500">{search ? "No memories match your search" : "No memories yet"}</div>
          ) : (
            <div className="p-2 space-y-0.5">
              {data.memories.map((m) => (
                <MemoryCard key={m.filename} filename={m.filename} name={m.name} type={m.type} scope={m.scope}
                  confidence={m.confidence} status={m.status} selected={selectedFile === m.filename}
                  onClick={() => setSelectedFile(m.filename)} />
              ))}
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          <MemoryDetail filename={selectedFile} />
        </div>
      </div>
    </div>
  );
}

export default function MemoriesPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <ExplorerContent />
    </QueryClientProvider>
  );
}
