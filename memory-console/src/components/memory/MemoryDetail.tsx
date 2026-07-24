"use client";

import { useMemoryDetail, useMemoryHistory } from "@/lib/hooks";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

interface MemoryDetailProps { filename: string | null; }

export function MemoryDetail({ filename }: MemoryDetailProps) {
  const { data: memory, isLoading } = useMemoryDetail(filename);
  const { data: history } = useMemoryHistory(filename);

  if (!filename) {
    return <div className="flex items-center justify-center h-full text-zinc-500 text-sm">Select a memory to inspect</div>;
  }

  if (isLoading) {
    return (
      <div className="p-4 space-y-3">
        <Skeleton className="h-5 w-48 bg-zinc-800" />
        <Skeleton className="h-4 w-32 bg-zinc-800" />
        <Skeleton className="h-24 w-full bg-zinc-800" />
      </div>
    );
  }

  if (!memory) {
    return <div className="flex items-center justify-center h-full text-red-400 text-sm">Memory not found</div>;
  }

  return (
    <div className="p-4 space-y-4">
      <div>
        <h2 className="text-base font-semibold text-zinc-100">{memory.name}</h2>
        <div className="flex items-center gap-2 mt-1">
          <Badge variant="outline" className="text-xs text-zinc-400 border-zinc-700">{memory.type}</Badge>
          <Badge variant="outline" className="text-xs text-zinc-400 border-zinc-700">{memory.scope}</Badge>
          <span className="text-xs text-zinc-500">Confidence: {memory.confidence}</span>
          {memory.status === "active" ? (
            <Badge className="text-xs bg-green-500/10 text-green-400 border-green-500/20">ACTIVE</Badge>
          ) : (
            <Badge variant="outline" className="text-xs text-zinc-500 border-zinc-700">{memory.status.toUpperCase()}</Badge>
          )}
        </div>
      </div>

      <div className="text-xs text-zinc-500 space-y-1">
        <div>Source: {memory.filename}</div>
        <div>Modified: {new Date(memory.mtimeMs).toLocaleDateString()}</div>
        <div>Recall Count: {memory.recallCount}</div>
      </div>

      <div className="border-t border-zinc-800 pt-3">
        <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">Content</h3>
        <pre className="text-sm text-zinc-300 whitespace-pre-wrap font-mono bg-zinc-900/50 rounded p-3 max-h-64 overflow-y-auto">{memory.content}</pre>
      </div>

      {history?.events && history.events.length > 0 && (
        <div className="border-t border-zinc-800 pt-3">
          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">Timeline</h3>
          <div className="space-y-2">
            {history.events.map((event: { action: string; timestamp: number; actor: string }, i: number) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="text-zinc-500">{new Date(event.timestamp).toLocaleDateString()}</span>
                <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 border-zinc-700 text-zinc-400">{event.action}</Badge>
                <span className="text-zinc-500">{event.actor}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
