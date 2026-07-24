"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useProposals, useApproveProposal, useRejectProposal } from "@/lib/hooks";
import { ProposalCard } from "@/components/governance/ProposalCard";
import { ProposalDetail } from "@/components/governance/ProposalDetail";
import { LiveIndicator } from "@/components/dashboard/LiveIndicator";
import type { GovernanceProposal } from "@/types/governance";

const queryClient = new QueryClient();

function ApprovalContent() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data: proposals, isLoading } = useProposals();
  const approveMutation = useApproveProposal();
  const rejectMutation = useRejectProposal();
  const selected = proposals?.find((p: GovernanceProposal) => p.id === selectedId) ?? null;
  const pendingCount = proposals?.filter((p: GovernanceProposal) => p.status === "pending").length ?? 0;

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <a href="/" className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors">Dashboard</a>
            <span className="text-zinc-700">/</span>
            <h1 className="text-lg font-semibold">Approval Center</h1>
            {pendingCount > 0 && (
              <span className="text-xs bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded">{pendingCount} pending</span>
            )}
          </div>
          <LiveIndicator status="connected" lastUpdate={new Date()} />
        </div>
      </header>
      <div className="flex h-[calc(100vh-57px)]">
        <div className="w-72 border-r border-zinc-800 overflow-y-auto flex-shrink-0">
          {isLoading ? (
            <div className="p-4 text-sm text-zinc-500">Loading proposals...</div>
          ) : !proposals?.length ? (
            <div className="p-4 text-sm text-zinc-500">No proposals</div>
          ) : (
            <div className="p-2 space-y-1">
              {proposals.map((p: GovernanceProposal) => (
                <ProposalCard key={p.id} proposal={p} selected={selectedId === p.id} onClick={() => setSelectedId(p.id)} />
              ))}
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          <ProposalDetail proposal={selected} onApprove={(id) => approveMutation.mutate(id)} onReject={(id) => rejectMutation.mutate(id)} isPending={approveMutation.isPending || rejectMutation.isPending} />
        </div>
      </div>
    </div>
  );
}

export default function ApprovalPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <ApprovalContent />
    </QueryClientProvider>
  );
}
