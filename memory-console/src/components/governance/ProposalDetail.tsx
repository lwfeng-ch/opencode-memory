"use client";
import { Button } from "@/components/ui/button";
import { RiskBadge } from "./RiskBadge";
import { ApprovalDiff } from "./ApprovalDiff";
import { EvidenceList } from "./EvidenceList";
import type { GovernanceProposal } from "@/types/governance";

export function ProposalDetail({ proposal, onApprove, onReject, isPending }: {
  proposal: GovernanceProposal | null;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  isPending?: boolean;
}) {
  if (!proposal) {
    return <div className="flex items-center justify-center h-full text-zinc-500 text-sm">Select a proposal to review</div>;
  }

  return (
    <div className="p-4 space-y-4">
      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-100">{proposal.targetMemory}</h2>
          <RiskBadge risk={proposal.risk} />
        </div>
        <p className="text-sm text-zinc-400 mt-1">Proposal #{proposal.id} · by {proposal.createdBy}</p>
      </div>

      {/* AI Explanation */}
      <div className="bg-blue-950/30 border border-blue-900/30 rounded-lg p-3 space-y-2">
        <h4 className="text-xs font-medium text-blue-400 uppercase tracking-wider">AI Analysis</h4>
        <p className="text-sm text-zinc-300">{proposal.aiExplanation.summary}</p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">Recommendation:</span>
          <span className="text-xs font-medium text-blue-400">{proposal.aiExplanation.recommendation}</span>
        </div>
        <div className="space-y-1">
          {Object.entries(proposal.aiExplanation.confidenceBreakdown).map(([key, val]) => (
            <div key={key} className="flex items-center gap-2 text-xs">
              <span className="text-zinc-500 w-28 capitalize">{key.replace(/([A-Z])/g, " $1").trim()}</span>
              <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full" style={{ width: `${val * 100}%` }} />
              </div>
              <span className="text-zinc-400 w-8 text-right">{(val * 100).toFixed(0)}%</span>
            </div>
          ))}
        </div>
      </div>

      {/* Risk Factors */}
      <div className="space-y-1.5">
        <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Risk Assessment</h4>
        <div className="grid grid-cols-3 gap-2 text-xs">
          {[
            { label: "Impact", value: proposal.riskFactors.impact },
            { label: "Blast Radius", value: proposal.riskFactors.blastRadius },
            { label: "Reversibility", value: proposal.riskFactors.reversibility, invert: true },
          ].map((f) => (
            <div key={f.label} className="bg-zinc-900/50 rounded p-2 text-center">
              <div className="text-zinc-500">{f.label}</div>
              <div className={`text-lg font-bold mt-1 ${f.invert ? (f.value > 0.7 ? "text-green-400" : "text-amber-400") : (f.value > 0.5 ? "text-red-400" : "text-green-400")}`}>
                {(f.value * 100).toFixed(0)}%
              </div>
            </div>
          ))}
        </div>
      </div>

      <ApprovalDiff before={proposal.before} after={proposal.after} />
      <EvidenceList evidence={proposal.evidence} />

      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <span>Confidence: {(proposal.confidence * 100).toFixed(0)}%</span>
        <span>·</span>
        <span>Created: {new Date(proposal.createdAt).toLocaleDateString()}</span>
        <span>·</span>
        <span>Status: {proposal.status}</span>
      </div>

      {proposal.status === "pending" && (
        <div className="flex gap-2 pt-2">
          <Button onClick={() => onApprove(proposal.id)} disabled={isPending}
            className="bg-green-600 hover:bg-green-700 text-white">Approve</Button>
          <Button onClick={() => onReject(proposal.id)} disabled={isPending} variant="outline"
            className="border-red-800 text-red-400 hover:bg-red-950">Reject</Button>
        </div>
      )}
    </div>
  );
}
