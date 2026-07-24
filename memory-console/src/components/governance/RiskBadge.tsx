"use client";
import { cn } from "@/lib/utils";
import type { RiskLevel } from "@/types/governance";

const riskConfig: Record<RiskLevel, { color: string; bg: string; label: string }> = {
  low: { color: "text-green-400", bg: "bg-green-500/10 border-green-500/20", label: "LOW" },
  medium: { color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20", label: "MEDIUM" },
  high: { color: "text-red-400", bg: "bg-red-500/10 border-red-500/20", label: "HIGH" },
  critical: { color: "text-red-500", bg: "bg-red-600/10 border-red-600/20", label: "CRITICAL" },
};

export function RiskBadge({ risk }: { risk: RiskLevel }) {
  const cfg = riskConfig[risk];
  return <span className={cn("text-xs px-1.5 py-0.5 rounded border font-medium", cfg.color, cfg.bg)}>{cfg.label}</span>;
}
