"use client";

import type { MemoryHeader } from "@/types/api";
import { cn } from "@/lib/utils";

const typeColors: Record<string, string> = {
  user: "border-blue-500/30",
  feedback: "border-amber-500/30",
  project: "border-green-500/30",
  reference: "border-purple-500/30",
};

interface MemoryCardProps {
  memory: MemoryHeader;
  selected?: boolean;
  onSelect?: () => void;
}

export function MemoryCard({ memory, selected, onSelect }: MemoryCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full text-left rounded-lg border p-4 transition-colors",
        "hover:bg-zinc-800/50",
        selected
          ? "border-zinc-500 bg-zinc-800/50"
          : "border-zinc-800 bg-zinc-900/50",
        typeColors[memory.type ?? ""] ?? "border-zinc-800",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium text-zinc-200 truncate">
            {memory.name}
          </div>
          {memory.description && (
            <div className="text-xs text-zinc-500 mt-1 line-clamp-2">
              {memory.description}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {memory.type && (
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">
              {memory.type}
            </span>
          )}
          {memory.confidence && (
            <span
              className={cn(
                "w-1.5 h-1.5 rounded-full",
                memory.confidence === "explicit"
                  ? "bg-green-500"
                  : memory.confidence === "inferred"
                    ? "bg-amber-500"
                    : "bg-zinc-500",
              )}
            />
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 mt-2 text-[10px] text-zinc-600">
        {memory.scope && <span>{memory.scope}</span>}
        {memory.recallCount !== undefined && (
          <span>recalled {memory.recallCount}x</span>
        )}
      </div>
    </button>
  );
}
