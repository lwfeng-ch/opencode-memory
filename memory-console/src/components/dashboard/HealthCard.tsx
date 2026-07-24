"use client";

import { cn } from "@/lib/utils";

interface HealthCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  color?: "green" | "amber" | "red" | "zinc";
}

const colorClasses = {
  green: "text-green-500",
  amber: "text-amber-500",
  red: "text-red-500",
  zinc: "text-zinc-400",
};

export function HealthCard({
  title,
  value,
  subtitle,
  color = "zinc",
}: HealthCardProps) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="text-sm text-zinc-400 font-medium">{title}</div>
      <div className={cn("text-2xl font-bold mt-1", colorClasses[color])}>
        {value}
      </div>
      {subtitle && (
        <div className="text-xs text-zinc-500 mt-1">{subtitle}</div>
      )}
    </div>
  );
}
