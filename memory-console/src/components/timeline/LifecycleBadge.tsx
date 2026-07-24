"use client";

const lifecycleColors: Record<string, string> = {
  create: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  update: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  merge: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  archive: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
  restore: "bg-green-500/10 text-green-400 border-green-500/20",
  active: "bg-green-500/10 text-green-400 border-green-500/20",
};

export function LifecycleBadge({ action }: { action: string }) {
  const colors = lifecycleColors[action.toLowerCase()] ?? "bg-zinc-500/10 text-zinc-400 border-zinc-500/20";
  return <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${colors}`}>{action.toUpperCase()}</span>;
}
