"use client";
import { Input } from "@/components/ui/input";

export function AuditFilter({ search, onSearchChange }: { search: string; onSearchChange: (v: string) => void }) {
  return (
    <div className="p-3 space-y-3">
      <Input placeholder="Search audit events..." value={search} onChange={(e) => onSearchChange(e.target.value)}
        className="bg-zinc-900 border-zinc-800 text-sm text-zinc-100 placeholder:text-zinc-500" />
    </div>
  );
}
