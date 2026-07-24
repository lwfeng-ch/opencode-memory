"use client";

export interface FilterState {
  scope: string;
  type: string;
  status: string;
  search: string;
}

interface MemoryFilterProps {
  filter: FilterState;
  onChange: (filter: FilterState) => void;
}

export function MemoryFilter({ filter, onChange }: MemoryFilterProps) {
  const update = (field: keyof FilterState, value: string) => {
    onChange({ ...filter, [field]: value });
  };

  return (
    <div className="flex items-center gap-3">
      <input
        type="text"
        placeholder="Search memories..."
        value={filter.search}
        onChange={(e) => update("search", e.target.value)}
        className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-600 transition-colors"
      />
      <select
        value={filter.scope}
        onChange={(e) => update("scope", e.target.value)}
        className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-400 focus:outline-none focus:border-zinc-600 transition-colors"
      >
        <option value="">All scopes</option>
        <option value="user">User</option>
        <option value="project">Project</option>
      </select>
      <select
        value={filter.type}
        onChange={(e) => update("type", e.target.value)}
        className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-400 focus:outline-none focus:border-zinc-600 transition-colors"
      >
        <option value="">All types</option>
        <option value="user">User</option>
        <option value="feedback">Feedback</option>
        <option value="project">Project</option>
        <option value="reference">Reference</option>
      </select>
    </div>
  );
}
