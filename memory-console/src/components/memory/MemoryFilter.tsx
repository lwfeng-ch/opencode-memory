"use client";

import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface MemoryFilterProps {
  search: string;
  onSearchChange: (value: string) => void;
  scope: string;
  onScopeChange: (value: string) => void;
}

export function MemoryFilter({ search, onSearchChange, scope, onScopeChange }: MemoryFilterProps) {
  return (
    <div className="space-y-3 p-3">
      <Input placeholder="Search memories..." value={search} onChange={(e) => onSearchChange(e.target.value)}
        className="bg-zinc-900 border-zinc-800 text-sm text-zinc-100 placeholder:text-zinc-500" />
      <Tabs value={scope} onValueChange={onScopeChange} className="w-full">
        <TabsList className="bg-zinc-900 w-full">
          <TabsTrigger value="all" className="text-xs flex-1">All</TabsTrigger>
          <TabsTrigger value="user" className="text-xs flex-1">User</TabsTrigger>
          <TabsTrigger value="project" className="text-xs flex-1">Project</TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}
