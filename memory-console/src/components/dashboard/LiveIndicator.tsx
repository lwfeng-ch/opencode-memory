"use client";

import { cn } from "@/lib/utils";

type LiveStatus = "connected" | "reconnecting" | "offline";

const statusConfig: Record<LiveStatus, { color: string; label: string }> = {
  connected: { color: "bg-green-500", label: "Live" },
  reconnecting: { color: "bg-amber-500 animate-pulse", label: "Reconnecting" },
  offline: { color: "bg-red-500", label: "Offline" },
};

export function LiveIndicator({ status, lastUpdate }: { status: LiveStatus; lastUpdate?: Date }) {
  const cfg = statusConfig[status];
  return (
    <div className="flex items-center gap-2 text-xs" title={`Last update: ${lastUpdate?.toLocaleTimeString() ?? "\u2014"}`}>
      <span className={cn("w-2 h-2 rounded-full", cfg.color)} />
      <span className="text-zinc-400">{cfg.label}</span>
      {lastUpdate && <span className="text-zinc-600">{lastUpdate.toLocaleTimeString()}</span>}
    </div>
  );
}
