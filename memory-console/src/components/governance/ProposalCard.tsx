"use client";
import { cn } from "@/lib/utils";
import { RiskBadge } from "./RiskBadge";
import type { GovernanceProposal } from "@/types/governance";

const actionStyles: Record<string, string> = { merge: "text-blue-400", archive: "text-zinc-400", delete: "text-red-400", split: "text-amber-400", resolve: "text-green-400" };

export function ProposalCard({ proposal, selected, onClick }: { proposal: GovernanceProposal; selected?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick} className={cn("w-full text-left px-3 py-3 rounded-md transition-colors border", "hover:bg-zinc-800/50", selected ? "bg-zinc-800 border-zinc-700" : "border-transparent")}>
      <div className="flex items-center justify-between">
        <span className={cn("text-xs font-medium uppercase", actionStyles[proposal.type])}>{proposal.type}</span>
        <RiskBadge risk={proposal.risk} />
      </div>
      <div className="text-sm font-medium text-zinc-100 mt-1 truncate">{proposal.targetMemory}</div>
      <div className="text-xs text-zinc-500 mt-1 line-clamp-1">{proposal.reason}</div>
      <div className="flex items-center gap-2 mt-2">
        <span className="text-xs text-zinc-500">Confidence: {(proposal.confidence * 100).toFixed(0)}%</span>
        <span className="text-xs text-zinc-600">|</span>
        <span className="text-xs text-zinc-500">{proposal.evidence.length} evidence</span>
        <span className="text-xs text-zinc-600">|</span>
        <span className="text-xs text-zinc-500">{proposal.createdBy}</span>
      </div>
    </button>
  );
}
