"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useProposals, useApproveProposal, useRejectProposal } from "@/lib/hooks";
import { ProposalCard } from "@/components/governance/ProposalCard";
import { ProposalDetail } from "@/components/governance/ProposalDetail";
import type { GovernanceProposal } from "@/types/governance";

const queryClient = new QueryClient();

/* ── Nav Link ───────────────────────────────────────────── */
function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className="group relative text-[12px] text-zinc-500 transition-colors hover:text-zinc-200">
      {children}
      <span className="absolute -bottom-1 left-0 h-px w-0 bg-zinc-400 transition-all duration-300 group-hover:w-full" />
    </a>
  );
}

/* ── Toast Notification ─────────────────────────────────── */
function Toast({ message, type, onClose }: { message: string; type: "success" | "error"; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-50 animate-fade-up">
      <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border backdrop-blur-sm ${
        type === "success" 
          ? "bg-emerald-950/80 border-emerald-800/50 text-emerald-300" 
          : "bg-red-950/80 border-red-800/50 text-red-300"
      }`}>
        <span className="text-sm">{message}</span>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 ml-2">×</button>
      </div>
    </div>
  );
}

function ApprovalContent() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const { data: proposals, isLoading, error } = useProposals();
  const approveMutation = useApproveProposal();
  const rejectMutation = useRejectProposal();
  const selected = proposals?.find((p: GovernanceProposal) => p.id === selectedId) ?? null;
  const pendingCount = proposals?.filter((p: GovernanceProposal) => p.status === "pending").length ?? 0;

  const handleApprove = (id: string) => {
    approveMutation.mutate(id, {
      onSuccess: () => {
        setToast({ message: `Proposal #${id} approved`, type: "success" });
        setTimeout(() => setToast(null), 3000);
        setSelectedId(null);
      },
      onError: (err) => {
        setToast({ message: `Failed to approve: ${err.message}`, type: "error" });
        setTimeout(() => setToast(null), 5000);
      },
    });
  };

  const handleReject = (id: string) => {
    rejectMutation.mutate(id, {
      onSuccess: () => {
        setToast({ message: `Proposal #${id} rejected`, type: "success" });
        setTimeout(() => setToast(null), 3000);
        setSelectedId(null);
      },
      onError: (err) => {
        setToast({ message: `Failed to reject: ${err.message}`, type: "error" });
        setTimeout(() => setToast(null), 5000);
      },
    });
  };

  return (
    <div className="relative min-h-screen bg-[#09090b] bg-dot-grid">
      <div className="fixed inset-0 bg-radial-glow pointer-events-none" />
      <div className="relative z-10 flex flex-col h-screen">
        {/* Header */}
        <header className="border-b border-white/[0.04] px-6 py-4 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-baseline gap-3">
              <h1 className="font-[family-name:var(--font-sora)] text-lg font-bold tracking-tight text-zinc-100">MemoryOS</h1>
              <span className="text-[10px] font-medium text-zinc-600 tracking-wide">APPROVAL CENTER</span>
              {pendingCount > 0 && (
                <span className="font-[family-name:var(--font-mono)] text-[10px] text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded">{pendingCount} pending</span>
              )}
            </div>
            <nav className="flex items-center gap-3 text-[12px]">
              <NavLink href="/">Dashboard</NavLink>
              <NavLink href="/memories">Explorer</NavLink>
              <NavLink href="/timeline">Timeline</NavLink>
              <NavLink href="/graph">Graph</NavLink>
              <NavLink href="/conflicts">Conflicts</NavLink>
              <NavLink href="/pipeline">Pipeline</NavLink>
              <NavLink href="/audit">Audit</NavLink>
              <NavLink href="/governance">Governance</NavLink>
            </nav>
          </div>
        </header>

        {/* Main */}
        <div className="flex flex-1 min-h-0">
          {/* Proposal List */}
          <div className="w-80 border-r border-white/[0.06] bg-white/[0.01] flex-shrink-0 overflow-y-auto">
            {isLoading ? (
              <div className="p-6 text-center">
                <div className="h-6 w-6 rounded-full border-2 border-zinc-700 border-t-blue-500 animate-spin mx-auto mb-3" />
                <span className="text-xs text-zinc-500 font-[family-name:var(--font-mono)]">loading proposals…</span>
              </div>
            ) : error ? (
              <div className="p-6 text-center">
                <div className="text-red-400 text-sm mb-2">Connection Failed</div>
                <div className="text-zinc-600 text-xs">Ensure plugin is running on port 4096</div>
              </div>
            ) : !proposals?.length ? (
              <div className="p-6 text-center">
                <div className="text-zinc-400 text-sm">No proposals</div>
                <div className="text-zinc-600 text-xs mt-1">Governance engine will create proposals when needed</div>
              </div>
            ) : (
              <div className="p-3 space-y-1.5">
                {proposals.map((p: GovernanceProposal) => (
                  <ProposalCard key={p.id} proposal={p} selected={selectedId === p.id} onClick={() => setSelectedId(p.id)} />
                ))}
              </div>
            )}
          </div>

          {/* Detail Panel */}
          <div className="flex-1 overflow-y-auto">
            <ProposalDetail 
              proposal={selected} 
              onApprove={handleApprove} 
              onReject={handleReject} 
              isPending={approveMutation.isPending || rejectMutation.isPending} 
            />
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
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