"use client";
import { RiskBadge } from "@/components/governance/RiskBadge";
import type { AuditEvent } from "@/types/governance";

export function AuditTable({ events, onSelect }: { events: AuditEvent[]; onSelect?: (e: AuditEvent) => void }) {
  return (
    <div className="w-full">
      <div className="grid grid-cols-5 gap-4 px-4 py-2 text-xs text-zinc-500 uppercase tracking-wider border-b border-zinc-800">
        <span>Time</span><span>Action</span><span>Actor</span><span>Risk</span><span>Result</span>
      </div>
      {events.map((event) => (
        <button key={event.id} onClick={() => onSelect?.(event)}
          className="w-full grid grid-cols-5 gap-4 px-4 py-2.5 text-sm hover:bg-zinc-900/50 transition-colors border-b border-zinc-800/50 text-left">
          <span className="text-zinc-400">{new Date(event.timestamp).toLocaleTimeString()}</span>
          <span className="text-zinc-200 font-medium">{event.action}</span>
          <span className="text-zinc-400">{event.actor}</span>
          <RiskBadge risk={event.risk} />
          <span className={event.result === "success" ? "text-green-400" : "text-red-400"}>{event.result}</span>
        </button>
      ))}
    </div>
  );
}
