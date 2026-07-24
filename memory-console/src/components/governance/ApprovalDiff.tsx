"use client";
export function ApprovalDiff({ before, after }: { before: string; after: string }) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Diff</h4>
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-zinc-900/50 rounded p-2 border border-red-500/20">
          <div className="text-[10px] text-red-400 uppercase mb-1">Before</div>
          <pre className="text-xs text-zinc-400 whitespace-pre-wrap font-mono">{before}</pre>
        </div>
        <div className="bg-zinc-900/50 rounded p-2 border border-green-500/20">
          <div className="text-[10px] text-green-400 uppercase mb-1">After</div>
          <pre className="text-xs text-green-300 whitespace-pre-wrap font-mono">{after}</pre>
        </div>
      </div>
    </div>
  );
}
