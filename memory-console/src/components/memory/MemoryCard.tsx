"use client";

import { cn } from "@/lib/utils";

interface MemoryCardProps {
  filename: string;
  name: string;
  type?: string;
  scope?: string;
  confidence?: string;
  status?: string;
  selected?: boolean;
  onClick?: () => void;
}

const confidenceColors: Record<string, string> = {
  explicit: "text-green-400",
  observed: "text-blue-400",
  inferred: "text-amber-400",
  derived: "text-zinc-400",
  uncertain: "text-zinc-500",
};

export function MemoryCard({ name, type, scope, confidence, status, selected, onClick }: MemoryCardProps) {
  const confidenceColor = confidence ? confidenceColors[confidence] ?? "text-zinc-400" : "text-zinc-400";

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-3 py-2 rounded-md transition-colors",
        "hover:bg-zinc-800/50 border border-transparent",
        selected && "bg-zinc-800 border-zinc-700",
      )}
    >
      <div className="text-sm font-medium text-zinc-100 truncate">{name || "Untitled"}</div>
      <div className="flex items-center gap-2 mt-1">
        {type && <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">{type}</span>}
        {scope && <span className="text-xs text-zinc-500">{scope}</span>}
        {confidence && <span className={cn("text-xs", confidenceColor)}>{confidence}</span>}
        {status === "archived" && <span className="text-xs text-zinc-500">ARCHIVED</span>}
      </div>
    </button>
  );
}
