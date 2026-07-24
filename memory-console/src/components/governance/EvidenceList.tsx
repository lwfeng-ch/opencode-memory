"use client";
import type { EvidenceItem } from "@/types/governance";

export function EvidenceList({ evidence }: { evidence: EvidenceItem[] }) {
  if (!evidence?.length) return null;
  return (
    <div className="space-y-1.5">
      <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Evidence</h4>
      {evidence.map((e) => (
        <div key={e.id} className="flex items-center justify-between text-xs bg-zinc-900/50 rounded px-2 py-1.5">
          <span className="text-zinc-400">{e.label}</span>
          <span className="text-zinc-500">{(e.score * 100).toFixed(0)}%</span>
        </div>
      ))}
    </div>
  );
}
