"use client";

import { TimelineEvent } from "./TimelineEvent";

interface TimelineEntry {
  action: string;
  timestamp: string;
  actor: string;
  detail?: string;
  beforeContent?: string;
  afterContent?: string;
}

export function MemoryTimeline({ memoryName, events, isActive }: { memoryName: string; events: TimelineEntry[]; isActive?: boolean }) {
  return (
    <div className="border border-zinc-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-zinc-100">{memoryName}</h3>
        {isActive && <span className="text-xs text-green-400 bg-green-500/10 px-2 py-0.5 rounded">ACTIVE</span>}
      </div>
      <div className="pl-1">
        {events.map((ev, i) => (
          <TimelineEvent key={i} {...ev} isLast={i === events.length - 1 && !isActive} />
        ))}
        {isActive && (
          <div className="flex gap-3">
            <div className="w-3 h-3 rounded-full bg-green-500 flex-shrink-0 mt-1" />
            <div className="text-xs text-green-400 pb-0">Current — Active</div>
          </div>
        )}
      </div>
    </div>
  );
}
