"use client";

import type { MemoryDetailResponse } from "@/types/api";

interface MemoryDetailProps {
  memory: MemoryDetailResponse;
  onClose?: () => void;
}

export function MemoryDetail({ memory, onClose }: MemoryDetailProps) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50">
      <div className="flex items-center justify-between p-4 border-b border-zinc-800">
        <div>
          <h3 className="text-sm font-medium text-zinc-200">
            {memory.name}
          </h3>
          {memory.description && (
            <p className="text-xs text-zinc-500 mt-0.5">
              {memory.description}
            </p>
          )}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Close
          </button>
        )}
      </div>

      <div className="p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {memory.type && (
            <span className="text-[10px] uppercase tracking-wider bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded">
              {memory.type}
            </span>
          )}
          {memory.scope && (
            <span className="text-[10px] uppercase tracking-wider bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded">
              {memory.scope}
            </span>
          )}
          {memory.confidence && (
            <span className="text-[10px] uppercase tracking-wider bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded">
              {memory.confidence}
            </span>
          )}
          {memory.status && (
            <span className="text-[10px] uppercase tracking-wider bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded">
              {memory.status}
            </span>
          )}
        </div>

        {memory.content && (
          <div className="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto">
            {memory.content}
          </div>
        )}

        <div className="text-[10px] text-zinc-600 space-y-0.5">
          {memory.filename && <div>File: {memory.filename}</div>}
          {memory.recallCount !== undefined && (
            <div>Recalled: {memory.recallCount}x</div>
          )}
          {memory.lastRecalledAt && (
            <div>Last recalled: {memory.lastRecalledAt}</div>
          )}
        </div>
      </div>
    </div>
  );
}
